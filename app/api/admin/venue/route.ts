import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader } from '@/lib/api-auth'
import { parseTime, toTimeString, type VenueHours, type VenueSettings } from '@/lib/venue'

// Opening hours and booking rules for the venue. Both tables are readable by
// any signed-in member and writable only here with the service key — they are
// venue-wide, not per-member, so an RLS-filtered browser write would report
// success and change nothing.
//
// These used to be the hardcoded array TIME_SLOTS = ['08:00'...'19:00'], copied
// into two files. Moving the venue's real hours behind a deploy was tolerable
// while Skedda held the real schedule; it is not now that this app does.

/** Accepts 'HH:MM' and 'HH:MM:SS', rejects anything that is not a real time. */
function validTime(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^(\d{1,2}):(\d{2})(:\d{2})?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return toTimeString(h * 60 + min)
}

/** NULL means "no limit" for the two caps, so empty input has to survive the trip. */
function optionalPositiveInt(v: unknown): number | null | undefined {
  if (v === null || v === '' || v === undefined) return null
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) return undefined
  return n
}

function positiveInt(v: unknown, min: number, max: number): number | undefined {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) return undefined
  return n
}

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = adminClient()
  const [{ data: hours, error: hoursError }, { data: settings, error: settingsError }] =
    await Promise.all([
      supabase.from('venue_hours').select('*').order('day_of_week'),
      supabase.from('venue_settings').select('*').eq('id', 1).maybeSingle(),
    ])

  if (hoursError || settingsError) {
    return NextResponse.json(
      { error: 'Could not load venue settings', detail: (hoursError || settingsError)?.message },
      { status: 500 }
    )
  }
  return NextResponse.json({ hours: hours || [], settings })
}

export async function PUT(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const supabase = adminClient()

  // ---- Hours -------------------------------------------------------------
  if (Array.isArray(body.hours)) {
    const rows: VenueHours[] = []
    for (const h of body.hours) {
      const day = positiveInt(h?.day_of_week, 0, 6)
      if (day === undefined) {
        return NextResponse.json({ error: 'Each day must be 0 (Sunday) through 6 (Saturday)' }, { status: 400 })
      }
      const open = validTime(h?.open_time)
      const close = validTime(h?.close_time)
      if (!open || !close) {
        return NextResponse.json({ error: 'Opening and closing times must look like 08:00' }, { status: 400 })
      }
      const isClosed = Boolean(h?.is_closed)
      // Mirrors the venue_hours_open_before_close constraint, so the member gets
      // a sentence instead of a Postgres error string.
      if (!isClosed && parseTime(open) >= parseTime(close)) {
        return NextResponse.json(
          { error: 'A day has to close after it opens. Mark it closed instead.' },
          { status: 400 }
        )
      }
      rows.push({ day_of_week: day, open_time: open, close_time: close, is_closed: isClosed })
    }

    if (rows.length) {
      const { error } = await supabase.from('venue_hours').upsert(rows, { onConflict: 'day_of_week' })
      if (error) {
        return NextResponse.json({ error: 'Could not save hours', detail: error.message }, { status: 500 })
      }
    }
  }

  // ---- Settings ----------------------------------------------------------
  if (body.settings && typeof body.settings === 'object') {
    const s = body.settings as Partial<VenueSettings>
    const patch: Record<string, unknown> = {}

    if ('slot_minutes' in s) {
      const v = positiveInt(s.slot_minutes, 5, 240)
      if (v === undefined) return NextResponse.json({ error: 'Slot length must be between 5 and 240 minutes' }, { status: 400 })
      patch.slot_minutes = v
    }
    if ('min_duration_minutes' in s) {
      const v = positiveInt(s.min_duration_minutes, 5, 1440)
      if (v === undefined) return NextResponse.json({ error: 'Minimum booking length must be at least 5 minutes' }, { status: 400 })
      patch.min_duration_minutes = v
    }
    if ('max_duration_minutes' in s) {
      const v = positiveInt(s.max_duration_minutes, 5, 1440)
      if (v === undefined) return NextResponse.json({ error: 'Maximum booking length must be at least 5 minutes' }, { status: 400 })
      patch.max_duration_minutes = v
    }
    if ('booking_horizon_days' in s) {
      const v = positiveInt(s.booking_horizon_days, 1, 730)
      if (v === undefined) return NextResponse.json({ error: 'Booking window must be between 1 and 730 days' }, { status: 400 })
      patch.booking_horizon_days = v
    }
    for (const key of ['max_active_bookings_per_member', 'max_minutes_per_member_per_day'] as const) {
      if (key in s) {
        const v = optionalPositiveInt(s[key])
        if (v === undefined) {
          return NextResponse.json({ error: 'Limits must be a whole number above zero, or blank for no limit' }, { status: 400 })
        }
        patch[key] = v
      }
    }

    if (Object.keys(patch).length) {
      // Read-modify-validate rather than trusting the patch alone: sending only
      // max_duration_minutes could otherwise leave it below the stored minimum
      // and every booking would be rejected by a rule nobody set on purpose.
      const { data: current } = await supabase.from('venue_settings').select('*').eq('id', 1).maybeSingle()
      const merged = { ...(current || {}), ...patch } as VenueSettings

      if (merged.min_duration_minutes > merged.max_duration_minutes) {
        return NextResponse.json(
          { error: 'The shortest booking cannot be longer than the longest booking.' },
          { status: 400 }
        )
      }
      // A minimum that is not a whole number of slots makes every slot on the
      // grid unbookable, with no visible reason why.
      if (merged.min_duration_minutes % merged.slot_minutes !== 0) {
        return NextResponse.json(
          { error: `The shortest booking must be a multiple of the ${merged.slot_minutes}-minute slot length.` },
          { status: 400 }
        )
      }

      patch.updated_at = new Date().toISOString()
      const { error } = await supabase.from('venue_settings').update(patch).eq('id', 1)
      if (error) {
        return NextResponse.json({ error: 'Could not save settings', detail: error.message }, { status: 500 })
      }
    }
  }

  const [{ data: hours }, { data: settings }] = await Promise.all([
    supabase.from('venue_hours').select('*').order('day_of_week'),
    supabase.from('venue_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  return NextResponse.json({ hours: hours || [], settings })
}
