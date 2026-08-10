import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/send-push'
import { sendEmail, notificationEmail } from '@/lib/send-email'
import { fetchMemberEmails } from '@/lib/member-emails'

// Event announcements, reminders and follow-ups.
//
// Every stage is gated on its own timestamp column rather than on "did this run
// land in the right half-hour slot". That is the important difference from
// /api/send-nudges: a slot match sends again on the next run if the window ever
// widens or the cron fires twice, which is exactly how every member once got
// two notifications for one scheduled time. Here a stage that has already run
// has a timestamp, so a re-run — or ten re-runs — sends nothing.
//
// Called by the same cron as the nudges, with the same bearer secret. As with
// that route, ANY plain POST is a live send; pass ?dry=1 to inspect.

export const maxDuration = 60

const HOUR = 3600_000

type EventRow = {
  id: string
  title: string
  event_date: string
  group_id: string | null
  event_type: string | null
  location: string | null
  notifications_enabled: boolean | null
  announced_at: string | null
  reminder_24h_sent_at: string | null
  reminder_1h_sent_at: string | null
  followup_sent_at: string | null
  followup_message: string | null
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.NUDGE_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const now = Date.now()

  // Anything that could still need a stage. Events more than a day past are
  // done with: their follow-up either went out or was backfilled as sent.
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, title, event_date, group_id, event_type, location, notifications_enabled, announced_at, reminder_24h_sent_at, reminder_1h_sent_at, followup_sent_at, followup_message')
    .gte('event_date', new Date(now - 36 * HOUR).toISOString())
    .order('event_date', { ascending: true })

  // A dead database hands back `{ data: null, error }` instead of throwing, so
  // without this the run reports a cheerful zero through a total outage.
  if (eventsError) {
    console.error('send-event-notices: events query failed:', eventsError.message)
    return NextResponse.json(
      { error: 'Database unreachable', detail: eventsError.message },
      { status: 503 }
    )
  }

  const live = (events || []).filter(e => e.notifications_enabled !== false) as EventRow[]

  // Subscriptions, fetched once and grouped by member — a member may have the
  // app on more than one device and all of them should ring.
  const { data: allSubs } = await supabase.from('push_subscriptions').select('*')
  const subsByUser = new Map<string, any[]>()
  for (const s of allSubs || []) {
    subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) || []), s])
  }

  // Names for the email greeting. Fetched once for everyone rather than per
  // audience, because a member can appear in several events in one sweep and
  // audienceFor/rsvpsFor both return bare ids.
  const { data: allProfiles } = await supabase.from('profiles').select('id, full_name')
  const namesByUser = new Map<string, string>(
    (allProfiles || []).map((p: any) => [p.id as string, (p.full_name || '') as string])
  )

  const skipped: Array<{ event: string; stage: string; reason: string }> = []
  const sentLog: Array<{ event: string; stage: string; recipients: number; delivered: number; by_email: number }> = []
  const stamps: Array<{ id: string; column: string; suppressed: boolean }> = []

  /** Members of the event's table. A NULL group_id is a legacy BT-wide event. */
  async function audienceFor(event: EventRow): Promise<string[]> {
    const { data, error } = event.group_id
      ? await supabase.from('profiles').select('id').eq('group_id', event.group_id)
      : await supabase.from('profiles').select('id').not('group_id', 'is', null)
    if (error) {
      console.error('audience lookup failed:', event.id, error.message)
      return []
    }
    return (data || []).map(p => p.id as string)
  }

  /** Only the members who said they were coming. */
  async function rsvpsFor(event: EventRow): Promise<string[]> {
    const { data, error } = await supabase
      .from('event_rsvps')
      .select('user_id')
      .eq('event_id', event.id)
    if (error) {
      console.error('rsvp lookup failed:', event.id, error.message)
      return []
    }
    return (data || []).map(r => r.user_id as string)
  }

  /**
   * Delivers to every member in `userIds`, by push where possible and by email
   * where not — never both, because the same event notice arriving twice is how
   * an announcement becomes a reason to mute the app.
   *
   * Push-only was the original behaviour, which meant an event announcement
   * reached only the members who had installed the PWA. On iOS push does not
   * work in Safari at all, so that was most of the table.
   */
  async function push(userIds: string[], title: string, body: string, url: string) {
    const withPush = userIds.filter(id => (subsByUser.get(id) || []).length > 0)
    const withoutPush = userIds.filter(id => (subsByUser.get(id) || []).length === 0)

    const emails = withoutPush.length
      ? await fetchMemberEmails(supabase, withoutPush)
      : new Map<string, string>()

    const pushResults = await Promise.all(
      withPush.flatMap(id =>
        (subsByUser.get(id) || []).map(async sub => {
          const res = dryRun ? 'would-send' : await sendPush(sub, { title, body, url })
          if (res === 'expired') {
            // Drop the one dead device, not the member's whole subscription.
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
          return res
        })
      )
    )

    const emailResults = await Promise.all(
      withoutPush.map(async id => {
        const to = emails.get(id)
        if (!to) return 'unreachable' as const
        const msg = notificationEmail({
          memberName: namesByUser.get(id)?.split(' ')[0] || 'there',
          subject: title,
          body,
          ctaLabel: 'See the details',
          ctaPath: url,
        })
        if (dryRun) return 'would-send' as const
        const res = await sendEmail({ to, ...msg })
        return res.sent
      })
    )

    return {
      attempted: pushResults.length + emailResults.filter(r => r !== 'unreachable').length,
      delivered:
        pushResults.filter(r => r === true || r === 'would-send').length +
        emailResults.filter(r => r === true || r === 'would-send').length,
      by_email: emailResults.filter(r => r === true || r === 'would-send').length,
      unreachable: emailResults.filter(r => r === 'unreachable').length,
    }
  }

  /**
   * Records that a stage is done. `suppressed` marks a stage we deliberately
   * skipped rather than sent — an event created twelve hours out never gets a
   * "tomorrow" reminder, and stamping it stops the run from reconsidering it
   * forever.
   */
  async function stamp(event: EventRow, column: string, suppressed = false) {
    stamps.push({ id: event.id, column, suppressed })
    if (dryRun) return
    const { error } = await supabase
      .from('events')
      .update({ [column]: new Date().toISOString() })
      .eq('id', event.id)
    // If the stamp fails the send would repeat next run, so this is worth
    // shouting about even though the notification itself went out fine.
    if (error) console.error(`stamp ${column} failed for ${event.id}:`, error.message)
  }

  function when(event: EventRow) {
    return new Date(event.event_date).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  for (const event of live) {
    const startsAt = new Date(event.event_date).getTime()
    const untilStart = startsAt - now

    // --- Announce: a newly created future event, once ---
    if (!event.announced_at) {
      if (untilStart <= 0) {
        await stamp(event, 'announced_at', true)
        skipped.push({ event: event.title, stage: 'announce', reason: 'event already started' })
      } else {
        const audience = await audienceFor(event)
        const { attempted, delivered, by_email } = await push(
          audience,
          'New Breakthrough Table event',
          `${event.title} — ${when(event)}${event.location ? ` at ${event.location}` : ''}`,
          '/events'
        )
        await stamp(event, 'announced_at')
        sentLog.push({ event: event.title, stage: 'announce', recipients: audience.length, delivered, by_email })
        if (attempted === 0) {
          skipped.push({ event: event.title, stage: 'announce', reason: 'nobody in the audience has push enabled' })
        }
      }
    }

    // --- Reminder: the day before ---
    if (!event.reminder_24h_sent_at) {
      if (untilStart <= 0) {
        await stamp(event, 'reminder_24h_sent_at', true)
      } else if (untilStart < 12 * HOUR) {
        // Created (or reached) too close to the event for a day-ahead reminder
        // to mean anything. Suppress rather than send "tomorrow" about tonight.
        await stamp(event, 'reminder_24h_sent_at', true)
        skipped.push({ event: event.title, stage: 'reminder_24h', reason: 'less than 12h out — too late to be a day-ahead reminder' })
      } else if (untilStart <= 36 * HOUR) {
        const audience = await rsvpsFor(event)
        const { delivered, by_email } = await push(
          audience,
          'Tomorrow at Breakthrough Table',
          `${event.title} — ${when(event)}`,
          '/events'
        )
        await stamp(event, 'reminder_24h_sent_at')
        sentLog.push({ event: event.title, stage: 'reminder_24h', recipients: audience.length, delivered, by_email })
      }
    }

    // --- Reminder: an hour out ---
    if (!event.reminder_1h_sent_at) {
      if (untilStart <= 0) {
        await stamp(event, 'reminder_1h_sent_at', true)
      } else if (untilStart <= 90 * 60_000) {
        const audience = await rsvpsFor(event)
        const { delivered, by_email } = await push(
          audience,
          'Starting soon',
          `${event.title} — ${when(event)}`,
          '/events'
        )
        await stamp(event, 'reminder_1h_sent_at')
        sentLog.push({ event: event.title, stage: 'reminder_1h', recipients: audience.length, delivered, by_email })
      }
    }

    // --- Follow-up: after it has finished ---
    // Events carry a start but no duration, so treat two hours after the start
    // as "over" rather than inventing an end time the leader never set.
    if (!event.followup_sent_at && untilStart <= -2 * HOUR) {
      const audience = await rsvpsFor(event)
      if (audience.length === 0) {
        await stamp(event, 'followup_sent_at', true)
        skipped.push({ event: event.title, stage: 'followup', reason: 'nobody RSVPed' })
      } else {
        const { delivered, by_email } = await push(
          audience,
          'Thanks for coming',
          event.followup_message?.trim() || `How was ${event.title}? Take a minute to note your next step.`,
          '/journal'
        )
        await stamp(event, 'followup_sent_at')
        sentLog.push({ event: event.title, stage: 'followup', recipients: audience.length, delivered, by_email })
      }
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    events_considered: live.length,
    events_skipped_notifications_off: (events || []).length - live.length,
    sent: sentLog,
    stamped: stamps,
    skipped,
  })
}
