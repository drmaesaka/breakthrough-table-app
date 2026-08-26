import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/send-push'
import { sendEmail, notificationEmail } from '@/lib/send-email'
import { fetchMemberEmails } from '@/lib/member-emails'
import { dayInTimezone } from '@/lib/dates'
import { fetchAllRows } from '@/lib/fetch-all'
import { calcAdherence } from '@/lib/habits'
import { retryQuery } from '@/lib/db-retry'

// This route fans out a push per member and rewrites every adherence figure.
// Vercel's default cap is 10s, which a table of any size will exceed.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.NUDGE_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?dry=1 evaluates and reports exactly who is due without sending anything.
  // The diagnostics in this response are worth inspecting at any time, but
  // every plain call is a live send — polling this endpoint to check state
  // will spam whoever happens to be due right now.
  const dryRun = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const now = new Date()

  // Convert a local HH:MM time string in a given timezone to UTC HH:MM
  function localTimeToUTC(localTime: string, timezone: string): string {
    try {
      const [h, m] = localTime.split(':').map(Number)
      // Build a date for today at that local time
      const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone }) // YYYY-MM-DD
      const localDate = new Date(`${todayStr}T${localTime}:00`)
      // Shift by the offset between UTC and the target timezone
      const utcFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
      // Get what "now" looks like in the user's timezone
      const nowInTZ = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(now)
      // Calculate offset: UTC time = local time - offset
      const [tzH, tzM] = nowInTZ.split(':').map(Number)
      const tzOffsetMin = (tzH * 60 + tzM) - (now.getUTCHours() * 60 + now.getUTCMinutes())
      const utcMin = (h * 60 + m - tzOffsetMin + 1440) % 1440
      const uh = Math.floor(utcMin / 60).toString().padStart(2, '0')
      const um = (utcMin % 60).toString().padStart(2, '0')
      // Round to nearest 30 min for matching
      const roundedUm = Number(um) < 30 ? '00' : '30'
      return `${uh}:${roundedUm}`
    } catch {
      return localTime // fallback: treat as UTC
    }
  }

  // The half-hour slot this run belongs to. This used to look back a trailing
  // 30 minutes, which overlapped the previous slot: a cron firing at :00 and
  // :30 matched a 09:00 nudge time on both runs and sent every member two
  // notifications for one scheduled time. Matching only the current block
  // keeps it to exactly one, at the cost of missing a slot entirely if a run
  // is delayed past its own block — which the scheduler alerts on.
  const timeWindow: string[] = [
    `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes() < 30 ? '00' : '30'}`,
  ]

  // Get members with their preferences and habit info. Leaders are included
  // only once they have a nudge_preferences row — participants get nudges by
  // default, leaders opt in by saving their Nudge Settings.
  // Retried: a transient rejection here does not delay this run, it deletes it.
  // The slot is never revisited, so the nudges due at this time never go out.
  const { data: participants, error: participantsError } = await retryQuery(
    'send-nudges: profiles',
    () => supabase
      .from('profiles')
      .select('id, full_name, role, group_id, adherence_percent, streak, nudge_preferences(enabled, tone, nudge_times, timezone)')
      .in('role', ['participant', 'leader'])
      .not('group_id', 'is', null)
  )

  // A dead database returns `{ data: null, error }` rather than throwing, which
  // would otherwise read as "nobody to nudge" and let the cron report success
  // through a total outage. 503 fails the workflow run so GitHub emails us.
  if (participantsError) {
    console.error('send-nudges: profiles query failed:', participantsError.message)
    return NextResponse.json(
      { error: 'Database unreachable', detail: participantsError.message },
      { status: 503 }
    )
  }

  if (!participants || participants.length === 0) {
    return NextResponse.json({ message: 'No participants to nudge' })
  }

  // Fetch push subscriptions for all participants
  const participantIds = participants.map((p: any) => p.id)
  const { data: allSubs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', participantIds)

  // Grouped, not keyed by member: a member may have the app installed on more
  // than one device, and keeping only the last row seen would nudge one of them
  // at random. Today the table holds at most one row per member, so this changes
  // nothing until the unique constraint is widened.
  const subsByUser = new Map<string, any[]>()
  for (const s of allSubs || []) {
    subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) || []), s])
  }
  const subsFor = (userId: string): any[] => subsByUser.get(userId) || []

  // Addresses for the members push cannot reach. Fetched once for the whole run
  // rather than per member: this sweeps the auth user list, and doing that
  // inside the per-member loop would be one round-trip each inside a function
  // with a 60-second ceiling.
  const withoutPush = participantIds.filter(id => subsFor(id).length === 0)
  const emailsByUser = withoutPush.length
    ? await fetchMemberEmails(supabase, withoutPush)
    : new Map<string, string>()

  // "Today" is each member's own calendar day, so a single UTC date would check
  // the wrong day for anyone whose timezone has already rolled over. Fetch a
  // three-day window and match each member against their own day.
  const dayWindow = [-1, 0, 1].map(offset =>
    new Date(now.getTime() + offset * 86400000).toISOString().split('T')[0]
  )
  const { data: habitRows } = await fetchAllRows<{ user_id: string; habit_id: string | null; completed_date: string }>(
    (from, to) => supabase
      .from('habit_completions')
      .select('user_id, habit_id, completed_date')
      .in('completed_date', dayWindow)
      .in('user_id', participantIds)
      .range(from, to)
  )

  // A member may run several habits at once, each tracked separately.
  const { data: liveHabits } = await fetchAllRows<{ id: string; user_id: string; name: string }>(
    (from, to) => supabase
      .from('habits')
      .select('id, user_id, name')
      .is('archived_at', null)
      .in('user_id', participantIds)
      .range(from, to)
  )

  const habitsByUser = new Map<string, { id: string; name: string }[]>()
  for (const h of liveHabits || []) {
    habitsByUser.set(h.user_id, [...(habitsByUser.get(h.user_id) || []), { id: h.id, name: h.name }])
  }

  // Keyed by habit, not by member: with several habits a bare user+date would
  // report every habit done as soon as one of them was.
  const doneKeys = new Set<string>()
  for (const row of habitRows || []) {
    if (row.habit_id) doneKeys.add(`${row.habit_id}:${row.completed_date}`)
  }

  /** The member's habits still outstanding on their own calendar day. */
  const outstandingHabits = (userId: string, timezone: string) => {
    const day = dayInTimezone(timezone, now)
    return (habitsByUser.get(userId) || []).filter(h => !doneKeys.has(`${h.id}:${day}`))
  }

  // Get reading completions for current period (tasks not archived)
  // We check if user has completed ALL current tasks for their group
  const { data: allTasks } = await fetchAllRows<{ id: string; group_id: string }>(
    (from, to) => supabase
      .from('tasks')
      .select('id, group_id')
      .eq('archived', false)
      .range(from, to)
  )

  // This used to read the whole of `task_completions`, every run, forever — an
  // unbounded scan of a table that is never pruned, silently truncated at 1000
  // rows by PostgREST. Adherence is computed from the result, so truncation
  // would not error, it would just start marking finished work as undone.
  // Narrowed to the completions that can actually affect this run, and paged.
  const currentTaskIds = allTasks.map(t => t.id)
  const { data: allCompletions } = currentTaskIds.length
    ? await fetchAllRows<{ user_id: string; task_id: string }>(
        (from, to) => supabase
          .from('task_completions')
          .select('user_id, task_id')
          .in('task_id', currentTaskIds)
          .in('user_id', participantIds)
          .range(from, to)
      )
    : { data: [] as { user_id: string; task_id: string }[] }

  // Build: which users have finished all reading for their group, and what each
  // member's adherence actually is right now.
  const readingDoneSet = new Set<string>()
  const freshAdherence = new Map<string, number>()
  for (const p of participants) {
    const groupTasks = (allTasks || []).filter((t: any) => t.group_id === p.group_id)
    const userCompletedIds = new Set(
      (allCompletions || []).filter((c: any) => c.user_id === p.id).map((c: any) => c.task_id)
    )
    if (groupTasks.length === 0) {
      readingDoneSet.add(p.id) // no reading assigned = reading done
    } else if (groupTasks.every((t: any) => userCompletedIds.has(t.id))) {
      readingDoneSet.add(p.id)
    }

    const prefs = Array.isArray(p.nudge_preferences) ? p.nudge_preferences[0] : p.nudge_preferences
    const tz = prefs?.timezone || 'America/Chicago'
    const allHabits = habitsByUser.get(p.id) || []
    const habitsLeft = outstandingHabits(p.id, tz).length
    // Shared with the tasks screen so the two cannot disagree: every task plus
    // every habit, each worth one.
    freshAdherence.set(p.id, calcAdherence(
      groupTasks.filter((t: any) => userCompletedIds.has(t.id)).length,
      allHabits.length - habitsLeft,
      groupTasks.length,
      allHabits.length
    ))
  }

  // adherence_percent was only ever written when a member tapped something on
  // /tasks, so the leaderboard drifted: a leader adding a task left everyone's
  // number wrong, and stale 100%s survived the daily habit reset. Recomputing
  // on every cron run bounds the staleness to one run.
  // Written in parallel — one round trip per member in series put the whole run
  // on a clock that a 40-50 member table would blow through.
  const adherenceResults = await Promise.all(
    participants.map(async p => {
      const next = freshAdherence.get(p.id)
      if (next === undefined || next === (p.adherence_percent ?? null)) return null
      if (!dryRun) {
        const { error } = await supabase
          .from('profiles')
          .update({ adherence_percent: next })
          .eq('id', p.id)
        if (error) {
          console.error('adherence update failed:', p.id, error.message)
          return null
        }
      }
      return `${p.full_name || p.id}: ${p.adherence_percent ?? '—'}→${next}`
    })
  )
  const adherenceUpdates = adherenceResults.filter((u): u is string => u !== null)

  // Why each member was passed over. A nudge that never arrives is otherwise
  // indistinguishable from one that was never due, which makes "why didn't I
  // get nudged?" unanswerable without guessing.
  const skipped: Array<{ name: string; reason: string; times: string }> = []

  const results = await Promise.all(
    participants
      .filter(p => {
        const prefs = Array.isArray(p.nudge_preferences) ? p.nudge_preferences[0] : p.nudge_preferences
        const name = p.full_name || p.id
        // Report the configured times on every skip, whichever check fired.
        // Otherwise an earlier reason hides whether their settings ever saved,
        // which is the first thing anyone asks about a missing nudge.
        const nudgeTimes: string[] = prefs?.nudge_times || ['09:00']
        const userTZ: string = prefs?.timezone || 'America/Chicago'
        const times = prefs
          ? `${nudgeTimes.join(', ')} ${userTZ}`
          : 'no saved settings (default 09:00 America/Chicago)'
        const skip = (reason: string) => { skipped.push({ name, reason, times }); return false }

        if (p.role === 'leader' && !prefs) return skip('leader has not saved nudge settings yet')
        if (prefs && prefs.enabled === false) return skip('nudges turned off in their settings')
        // Only nudge if a habit is outstanding OR reading is not done.
        if (outstandingHabits(p.id, userTZ).length === 0 && readingDoneSet.has(p.id)) {
          return skip('habits and reading both already done')
        }
        // Convert user's local nudge times to UTC and check against current window
        const slotsUTC = nudgeTimes.map(t => localTimeToUTC(t, userTZ))
        if (!slotsUTC.some(t => timeWindow.includes(t))) {
          return skip(`no nudge time in this window (${slotsUTC.join(', ')} UTC)`)
        }
        return true
      })
      .map(async (participant) => {
        const firstName = participant.full_name?.split(' ')[0] || 'there'
        const prefs = Array.isArray(participant.nudge_preferences) ? participant.nudge_preferences[0] : participant.nudge_preferences
        const tone = prefs?.tone || 'encouraging'

        const pending = outstandingHabits(participant.id, prefs?.timezone || 'America/Chicago')
        // Fully formed including its own quotes, so the templates below do not
        // have to quote it — with several habits the label carries a closing
        // quote mid-phrase and an outer pair would strand one at the end.
        //
        // Naming one habit keeps the nudge concrete; listing four turns a lock
        // screen notification into something nobody reads.
        const habit = pending.length === 0
          ? 'your habit'
          : pending.length === 1
            ? `"${pending[0].name}"`
            : `"${pending[0].name}" and ${pending.length - 1} more`
        const readingDone = readingDoneSet.has(participant.id)

        // Pick what to nudge about
        const needsHabit = pending.length > 0
        const needsReading = !readingDone

        let message: string

        if (needsHabit && needsReading) {
          // Both outstanding
          if (tone === 'direct') {
            message = `${firstName}: reading and ${habit} still pending. Get both done.`
          } else if (tone === 'gentle') {
            message = `Hey ${firstName} — when you get a moment, your reading and ${habit} are both still waiting 🌱`
          } else if (tone === 'competitive') {
            message = `${firstName} — your table is checking things off. Reading + ${habit} still open. Don't fall behind. 🏆`
          } else {
            message = `Hey ${firstName}! Two things still open: your reading and ${habit}. You've got this 💪`
          }
        } else if (needsHabit) {
          // Only habit outstanding
          if (tone === 'direct') {
            message = `${firstName}: ${habit} not checked in today. Do it.`
          } else if (tone === 'gentle') {
            message = `Just a soft reminder ${firstName} — did you get to ${habit} today? 🌱`
          } else if (tone === 'competitive') {
            message = `${firstName} — streak on the line. ${habit} isn't checked yet. 🔥`
          } else {
            message = `Hey ${firstName} — don't forget to check in ${habit} today! Keep that streak alive 🔥`
          }
        } else {
          // Only reading outstanding
          if (tone === 'direct') {
            message = `${firstName}: reading not done this period. Finish it.`
          } else if (tone === 'gentle') {
            message = `Hey ${firstName}, just a reminder — your reading material is still waiting when you're ready 📚`
          } else if (tone === 'competitive') {
            message = `${firstName} — habit is done but reading isn't. Finish strong. 📚`
          } else {
            message = `Nice work on your habit ${firstName}! Reading material still needs a check — almost at 100% 📚`
          }
        }

        const subs = subsFor(participant.id)

        // No push: fall back to email rather than skipping. Push only works
        // inside the installed PWA, so "no subscription" describes most members
        // — exactly the people a nudge is supposed to pull back in.
        if (subs.length === 0) {
          const to = emailsByUser.get(participant.id)
          if (!to) {
            skipped.push({
              name: participant.full_name || participant.id,
              reason: 'due for a nudge, but no push subscription and no email address on the account',
              times: `${prefs?.nudge_times?.join(', ') || '09:00'} ${prefs?.timezone || 'America/Chicago'}`,
            })
            return null
          }

          const msg = notificationEmail({
            memberName: firstName,
            subject: 'Your Breakthrough Table nudge',
            body: message,
            ctaLabel: 'Open your tasks',
            ctaPath: '/tasks',
            greeting: false,
          })
          const res = dryRun ? null : await sendEmail({ to, ...msg })
          return {
            id: participant.id,
            name: participant.full_name,
            message,
            result: dryRun ? 'would-send' : res!.sent,
            devices: 0,
            channel: 'email' as const,
          }
        }

        const deviceResults = await Promise.all(
          subs.map(async sub => {
            const res = dryRun
              ? 'would-send'
              : await sendPush(sub, { title: 'Breakthrough Table', body: message, url: '/tasks' })
            if (res === 'expired') {
              // Drop the one dead device. Deleting by user_id unsubscribed the
              // member entirely because one of their devices went stale.
              await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
            }
            return res
          })
        )

        // One member, one outcome: delivered if any device took it.
        const result = deviceResults.includes(true)
          ? true
          : deviceResults.includes('would-send')
            ? 'would-send'
            : deviceResults.every(r => r === 'expired')
              ? 'expired'
              : false
        return {
          id: participant.id,
          name: participant.full_name,
          message,
          result,
          devices: subs.length,
          channel: 'push' as const,
        }
      })
  )

  // --- Scheduled reminders (no CTA, leader-configured message) ---
  const { data: reminderSettings } = await supabase
    .from('group_notification_settings')
    .select('group_id, reminder_enabled, reminder_time, reminder_message, checkin_timezone')
    .eq('reminder_enabled', true)
    .not('reminder_message', 'is', null)

  // Sends fan out in parallel. This was a sequential nested loop — every group,
  // then every member inside it, one awaited push at a time — which is the one
  // path in this route that would time out first as a table grows.
  const dueReminders = (reminderSettings || []).filter(setting =>
    timeWindow.includes(
      localTimeToUTC(setting.reminder_time, setting.checkin_timezone || 'America/Chicago')
    )
  )

  const reminderResults = (await Promise.all(
    dueReminders.map(async setting => {
      const { data: groupParticipants } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('group_id', setting.group_id)

      if (!groupParticipants || groupParticipants.length === 0) return []

      const gpIds = groupParticipants.map((p: any) => p.id)
      const { data: gpSubs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .in('user_id', gpIds)

      // A member can have more than one device, so group the subscriptions
      // rather than keeping only the last one seen for each member.
      const subsByUser = new Map<string, any[]>()
      for (const s of gpSubs || []) {
        subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) || []), s])
      }

      // Same fallback as the nudges above. A leader who schedules a reminder for
      // their table means all of it, not just the members who installed the PWA.
      const gpWithoutPush = gpIds.filter((id: string) => !(subsByUser.get(id) || []).length)
      const gpEmails = gpWithoutPush.length
        ? await fetchMemberEmails(supabase, gpWithoutPush)
        : new Map<string, string>()

      return Promise.all(
        groupParticipants.map(async (p: any) => {
          const devices = subsByUser.get(p.id) || []

          if (devices.length > 0) {
            const results = await Promise.all(
              devices.map(async sub => {
                const res = dryRun
                  ? 'would-send'
                  : await sendPush(sub, { title: 'Breakthrough Table', body: setting.reminder_message })
                if (res === 'expired') {
                  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
                }
                return res
              })
            )
            // One member, one outcome — delivered if any of their devices took it.
            const result = results.includes(true)
              ? true
              : results.includes('would-send')
                ? 'would-send'
                : results.every(r => r === 'expired')
                  ? 'expired'
                  : false
            return { id: p.id, name: p.full_name, result, channel: 'push' as const }
          }

          const to = gpEmails.get(p.id)
          if (!to) return { id: p.id, name: p.full_name, result: 'unreachable' as const, channel: 'none' as const }

          const msg = notificationEmail({
            memberName: p.full_name?.split(' ')[0] || 'there',
            subject: 'A reminder from your table',
            body: setting.reminder_message,
            ctaLabel: 'Open Breakthrough Table',
            ctaPath: '/dashboard',
          })
          const res = dryRun ? null : await sendEmail({ to, ...msg })
          return {
            id: p.id,
            name: p.full_name,
            result: dryRun ? ('would-send' as const) : res!.sent,
            channel: 'email' as const,
          }
        })
      )
    })
  )).flat()

  // `results` holds a null for every matched member we could not reach at all,
  // so its length was never the number of notifications that actually went out.
  const attempted = results.filter(r => r !== null) as Array<{
    result: boolean | 'expired' | 'would-send'
    channel: 'push' | 'email'
  }>
  // Counted separately because they diagnose different things: a push failure
  // points at VAPID keys or a stale device, an email failure at Resend. Rolling
  // them into one number would make the 500 below fire on the wrong evidence.
  const pushAttempts = attempted.filter(r => r.channel === 'push')
  const emailAttempts = attempted.filter(r => r.channel === 'email')
  const delivered = pushAttempts.filter(r => r.result === true).length
  const hardFailed = pushAttempts.filter(r => r.result === false).length
  const emailsDelivered = emailAttempts.filter(r => r.result === true).length
  const emailsFailed = emailAttempts.filter(r => r.result === false).length
  // Split by channel for the same reason as the nudges: the 500 at the bottom is
  // a push-setup alarm, and counting a delivered email as a delivered push would
  // silence it exactly when push is broken for everyone.
  const reminderPush = reminderResults.filter(r => r.channel === 'push')
  const reminderEmail = reminderResults.filter(r => r.channel === 'email')
  const reminderDelivered = reminderPush.filter(r => r.result === true).length
  const reminderHardFailed = reminderPush.filter(r => r.result === false).length
  const reminderEmailsDelivered = reminderEmail.filter(r => r.result === true).length
  const reminderEmailsFailed = reminderEmail.filter(r => r.result === false).length

  const body = {
    dry_run: dryRun,
    nudges_delivered: delivered,
    nudges_failed: hardFailed,
    reminders_delivered: reminderDelivered,
    reminders_failed: reminderHardFailed,
    utc_window: timeWindow,
    members_considered: participants.length,
    // Who could receive a push right now, regardless of whether one was due.
    // Without this, a member whose notifications never worked stays invisible
    // until their nudge time arrives and quietly delivers nothing.
    adherence_updated: adherenceUpdates,
    // Stored vs freshly computed, for verifying admin actions like a period
    // reset actually landed. Dry runs only — keeps normal cron output small.
    ...(dryRun ? {
      member_state: participants.map(p => ({
        name: p.full_name || p.id,
        stored_adherence: p.adherence_percent,
        computed_adherence: freshAdherence.get(p.id),
        streak: p.streak,
      })),
    } : {}),
    nudge_emails_delivered: emailsDelivered,
    nudge_emails_failed: emailsFailed,
    reminder_emails_delivered: reminderEmailsDelivered,
    reminder_emails_failed: reminderEmailsFailed,
    push_ready: participants.filter(p => subsFor(p.id).length > 0).length,
    members_without_push: participants.filter(p => subsFor(p.id).length === 0).map(p => p.full_name || p.id),
    // No push AND no address. These people cannot be reached by this app at all,
    // which is a roster problem rather than a delivery one — worth seeing apart
    // from members_without_push, who email still reaches.
    unreachable: participants
      .filter(p => subsFor(p.id).length === 0 && !emailsByUser.get(p.id))
      .map(p => p.full_name || p.id),
    skipped,
    results,
    reminderResults,
  }

  // Pushes actively rejected with nothing getting through points at the push
  // setup itself (bad VAPID keys, missing env vars), not one stale device.
  // Expired subscriptions are excluded — those are normal and self-healing.
  if (hardFailed + reminderHardFailed > 0 && delivered + reminderDelivered === 0) {
    return NextResponse.json({ ...body, error: 'All push sends failed' }, { status: 500 })
  }

  return NextResponse.json(body)
}
