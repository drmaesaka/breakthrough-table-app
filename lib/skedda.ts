import ical from 'node-ical'

/**
 * Reads Breakthrough Table's Skedda schedule.
 *
 * Skedda is the venue's system of record for the physical suites, and this app
 * has its own `room_bookings` table. Those two know nothing about each other,
 * so the same suite can be booked in both and each will report success. This
 * module pulls Skedda's bookings in so the app can at least stop offering slots
 * that are already taken in the real schedule.
 *
 * Direction matters: Skedda publishes a **read-only** venue iCal feed, and its
 * public integration surface is outbound (webhooks on create/cancel/change).
 * There is no confirmed way to write a booking *into* Skedda from here, so this
 * is deliberately one-way. Do not build a UI that implies otherwise.
 *
 * The feed URL carries its own security key, so it lives in SKEDDA_ICAL_URL
 * (server-only — never NEXT_PUBLIC, it must not reach the browser). With no
 * env var set every function here reports `configured: false` and the app
 * behaves exactly as it did before.
 */

export type BusyBlock = {
  /** Skedda space name, from the event's LOCATION (falling back to SUMMARY). */
  space: string
  start: Date
  end: Date
  title: string
}

export type SkeddaResult = {
  configured: boolean
  blocks: BusyBlock[]
  /** Set when the feed is configured but could not be read. */
  error?: string
}

export function skeddaConfigured(): boolean {
  return Boolean(process.env.SKEDDA_ICAL_URL)
}

/**
 * Busy blocks overlapping [from, to]. Recurring bookings are expanded, and
 * cancelled events and EXDATE exceptions are dropped.
 */
export async function fetchSkeddaBusy(from: Date, to: Date): Promise<SkeddaResult> {
  const url = process.env.SKEDDA_ICAL_URL
  if (!url) return { configured: false, blocks: [] }

  let data: Record<string, any>
  try {
    data = await ical.async.fromURL(url)
  } catch (err: any) {
    // A dead feed must not take the booking page down with it — the page still
    // works, it just loses Skedda awareness, and the caller can surface that.
    console.error('skedda: feed fetch failed:', err?.message)
    return { configured: true, blocks: [], error: err?.message || 'Feed unreachable' }
  }

  const blocks: BusyBlock[] = []

  for (const key of Object.keys(data)) {
    const ev = data[key]
    if (!ev || ev.type !== 'VEVENT') continue
    if (String(ev.status || '').toUpperCase() === 'CANCELLED') continue
    if (!ev.start || !ev.end) continue

    const space = String(ev.location || ev.summary || '').trim()
    const title = String(ev.summary || 'Booked').trim()
    const durationMs = new Date(ev.end).getTime() - new Date(ev.start).getTime()

    if (!ev.rrule) {
      const start = new Date(ev.start)
      const end = new Date(ev.end)
      if (end > from && start < to) blocks.push({ space, start, end, title })
      continue
    }

    // Recurring booking — a standing weekly slot is normal in a coworking
    // space, and treating only the first occurrence as busy would leave every
    // later week bookable in this app while occupied in reality.
    const excluded = new Set<number>(
      Object.values(ev.exdate || {}).map((d: any) => new Date(d).getTime())
    )

    let occurrences: Date[] = []
    try {
      occurrences = ev.rrule.between(new Date(from.getTime() - durationMs), to, true)
    } catch (err: any) {
      console.error('skedda: could not expand recurrence for', title, err?.message)
      continue
    }

    for (const occurrence of occurrences) {
      if (excluded.has(occurrence.getTime())) continue

      // A single moved/edited instance of a series overrides the generated one.
      const override = ev.recurrences?.[toDateKey(occurrence)]
      const start = override ? new Date(override.start) : occurrence
      const end = override ? new Date(override.end) : new Date(occurrence.getTime() + durationMs)
      if (override && String(override.status || '').toUpperCase() === 'CANCELLED') continue

      if (end > from && start < to) {
        blocks.push({
          space: String(override?.location || ev.location || ev.summary || '').trim(),
          start,
          end,
          title: String(override?.summary || title).trim(),
        })
      }
    }
  }

  blocks.sort((a, b) => a.start.getTime() - b.start.getTime())
  return { configured: true, blocks }
}

/** node-ical keys its recurrence overrides by local YYYY-MM-DD. */
function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Whether a Skedda space name refers to one of this app's rooms.
 *
 * The two systems name things independently, so this matches loosely: the
 * app's room name or suite appearing anywhere in the Skedda space string.
 * Anything unmatched is reported by the caller rather than silently ignored —
 * an unmatched space means real bookings the app cannot see.
 */
export function spaceMatchesRoom(
  skeddaSpace: string,
  room: { name?: string | null; suite?: string | null }
): boolean {
  const haystack = skeddaSpace.toLowerCase()
  if (!haystack) return false
  const candidates = [room.suite, room.name]
    .map(v => (v || '').trim().toLowerCase())
    .filter(v => v.length > 2)
  return candidates.some(c => haystack.includes(c))
}
