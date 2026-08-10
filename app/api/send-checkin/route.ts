import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/send-push'
import { sendEmail, notificationEmail } from '@/lib/send-email'
import { fetchMemberEmails } from '@/lib/member-emails'

// Fans out a push per member; the 10s default would cut a real table off.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.NUDGE_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?dry=1 reports what would be sent without sending — see send-nudges.
  const dryRun = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const now = new Date()

  // Only the half-hour slot this run belongs to — a trailing 30-minute
  // lookback overlapped the previous slot and sent each check-in twice.
  const timeWindow: string[] = [
    `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes() < 30 ? '00' : '30'}`,
  ]

  function localTimeToUTC(localTime: string, timezone: string): string {
    try {
      const [h, m] = localTime.split(':').map(Number)
      const nowInTZ = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(now)
      const [tzH, tzM] = nowInTZ.split(':').map(Number)
      const tzOffsetMin = (tzH * 60 + tzM) - (now.getUTCHours() * 60 + now.getUTCMinutes())
      const utcMin = (h * 60 + m - tzOffsetMin + 1440) % 1440
      const uh = Math.floor(utcMin / 60).toString().padStart(2, '0')
      const um = (utcMin % 60) < 30 ? '00' : '30'
      return `${uh}:${um}`
    } catch { return localTime }
  }

  const { data: settings, error: settingsError } = await supabase
    .from('group_notification_settings')
    .select('group_id, checkin_enabled, checkin_time, checkin_timezone')
    .eq('checkin_enabled', true)

  // A dead database returns `{ data: null, error }` rather than throwing, which
  // would otherwise read as "nothing configured" and let the cron report success
  // through a total outage. 503 fails the workflow run so GitHub emails us.
  if (settingsError) {
    console.error('send-checkin: settings query failed:', settingsError.message)
    return NextResponse.json(
      { error: 'Database unreachable', detail: settingsError.message },
      { status: 503 }
    )
  }

  if (!settings || settings.length === 0) {
    return NextResponse.json({ message: 'No check-in settings configured' })
  }

  const activeGroups = settings.filter((s: any) => {
    const utcTime = localTimeToUTC(s.checkin_time, s.checkin_timezone || 'America/Chicago')
    return timeWindow.includes(utcTime)
  })

  if (activeGroups.length === 0) {
    return NextResponse.json({ message: 'No groups scheduled for this window' })
  }

  const groupIds = activeGroups.map((s: any) => s.group_id)

  const { data: participants } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('group_id', groupIds)

  if (!participants || participants.length === 0) {
    return NextResponse.json({ message: 'No participants to notify' })
  }

  const userIds = participants.map((p: any) => p.id)
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds)

  // Grouped per member so a second device is notified too, rather than the map
  // silently keeping whichever row came back last.
  const subsByUser = new Map<string, any[]>()
  for (const s of subs || []) {
    subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) || []), s])
  }

  // This used to return "No push subscriptions found" and stop here whenever the
  // table was empty, which is precisely the population email exists to reach.
  const withoutPush = participants.filter((p: any) => !(subsByUser.get(p.id) || []).length)
  const emailsByUser = withoutPush.length
    ? await fetchMemberEmails(supabase, withoutPush.map((p: any) => p.id))
    : new Map<string, string>()

  const unreachable: string[] = []

  const outcomes = await Promise.all(
    participants.map(async (p: any) => {
      const firstName = p.full_name?.split(' ')[0] || 'there'
      const body = `Hey ${firstName} — time to check in your habit and reading for today! 📋`
      const devices = subsByUser.get(p.id) || []

      // Push OR email, never both. The same reminder arriving twice is how a
      // re-engagement nudge turns into the reason someone mutes you.
      if (devices.length > 0) {
        const results = await Promise.all(
          devices.map(async sub => {
            const result = dryRun ? 'would-send' : await sendPush(sub, {
              title: 'Breakthrough Table',
              body,
              url: '/tasks',
            })
            if (result === 'expired') {
              // By endpoint, not user_id — one stale device used to unsubscribe
              // the member from every device they own.
              await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
            }
            return result
          })
        )
        return { channel: 'push' as const, results }
      }

      const to = emailsByUser.get(p.id)
      if (!to) {
        unreachable.push(p.full_name || p.id)
        return { channel: 'none' as const, results: [] as any[] }
      }

      const msg = notificationEmail({
        memberName: firstName,
        subject: 'Time to check in',
        body,
        ctaLabel: 'Check in',
        ctaPath: '/tasks',
        // The body already opens "Hey <name> —".
        greeting: false,
      })
      const res = dryRun
        ? { sent: false as const, reason: 'not_configured' as const }
        : await sendEmail({ to, ...msg })
      return { channel: 'email' as const, results: [dryRun ? 'would-send' : res.sent] }
    })
  )

  const pushResults = outcomes.filter(o => o.channel === 'push').flatMap(o => o.results)
  const emailOutcomes = outcomes.filter(o => o.channel === 'email')

  return NextResponse.json({
    dry_run: dryRun,
    sent: pushResults.filter(r => r === true).length,
    would_send: pushResults.filter(r => r === 'would-send').length,
    emails_sent: emailOutcomes.filter(o => o.results[0] === true).length,
    emails_would_send: dryRun ? emailOutcomes.length : 0,
    members_considered: participants.length,
    members_without_push: withoutPush.map((p: any) => p.full_name || p.id),
    // Neither channel can reach these people. That is a real gap in the roster,
    // not a delivery failure, so it is reported separately from a failed send.
    unreachable,
  })
}
