import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.NUDGE_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const today = new Date().toISOString().split('T')[0]

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

  // Current UTC window (last 30 min, snapped to :00 or :30)
  const timeWindow: string[] = []
  for (let offset = 0; offset < 30; offset++) {
    const d = new Date(now.getTime() - offset * 60 * 1000)
    const h = d.getUTCHours().toString().padStart(2, '0')
    const m = d.getUTCMinutes() < 30 ? '00' : '30'
    const t = `${h}:${m}`
    if (!timeWindow.includes(t)) timeWindow.push(t)
  }

  // Get participants with their preferences and habit info
  const { data: participants } = await supabase
    .from('profiles')
    .select('id, full_name, onesignal_id, group_id, adherence_percent, current_habit, nudge_preferences(enabled, tone, nudge_times, timezone)')
    .eq('role', 'participant')
    .not('group_id', 'is', null)
    .not('onesignal_id', 'is', null)

  if (!participants || participants.length === 0) {
    return NextResponse.json({ message: 'No participants to nudge' })
  }

  // Get today's habit completions
  const { data: habitDoneToday } = await supabase
    .from('habit_completions')
    .select('user_id')
    .eq('completed_date', today)

  const habitDoneSet = new Set((habitDoneToday || []).map((h: any) => h.user_id))

  // Get reading completions for current period (tasks not archived)
  // We check if user has completed ALL current tasks for their group
  const { data: allTasks } = await supabase
    .from('tasks')
    .select('id, group_id')
    .eq('archived', false)

  const { data: allCompletions } = await supabase
    .from('task_completions')
    .select('user_id, task_id')

  // Build: which users have finished all reading for their group
  const readingDoneSet = new Set<string>()
  for (const p of participants) {
    const groupTasks = (allTasks || []).filter((t: any) => t.group_id === p.group_id)
    if (groupTasks.length === 0) {
      readingDoneSet.add(p.id) // no reading assigned = reading done
      continue
    }
    const userCompletedIds = new Set(
      (allCompletions || []).filter((c: any) => c.user_id === p.id).map((c: any) => c.task_id)
    )
    const allRead = groupTasks.every((t: any) => userCompletedIds.has(t.id))
    if (allRead) readingDoneSet.add(p.id)
  }

  const results = await Promise.all(
    participants
      .filter(p => {
        const prefs = Array.isArray(p.nudge_preferences) ? p.nudge_preferences[0] : p.nudge_preferences
        if (prefs && prefs.enabled === false) return false
        // Only nudge if habit not done OR reading not done
        if (habitDoneSet.has(p.id) && readingDoneSet.has(p.id)) return false
        // Convert user's local nudge times to UTC and check against current window
        const nudgeTimes: string[] = prefs?.nudge_times || ['09:00']
        const userTZ: string = prefs?.timezone || 'America/Chicago'
        const scheduledNow = nudgeTimes.some(t => timeWindow.includes(localTimeToUTC(t, userTZ)))
        return scheduledNow
      })
      .map(async (participant) => {
        const firstName = participant.full_name?.split(' ')[0] || 'there'
        const habit = participant.current_habit || 'your habit'
        const prefs = Array.isArray(participant.nudge_preferences) ? participant.nudge_preferences[0] : participant.nudge_preferences
        const tone = prefs?.tone || 'encouraging'

        const habitDone = habitDoneSet.has(participant.id)
        const readingDone = readingDoneSet.has(participant.id)

        // Pick what to nudge about
        const needsHabit = !habitDone
        const needsReading = !readingDone

        let message: string

        if (needsHabit && needsReading) {
          // Both outstanding
          if (tone === 'direct') {
            message = `${firstName}: reading and "${habit}" still pending. Get both done.`
          } else if (tone === 'gentle') {
            message = `Hey ${firstName} — when you get a moment, your reading and "${habit}" are both still waiting 🌱`
          } else if (tone === 'competitive') {
            message = `${firstName} — your table is checking things off. Reading + "${habit}" still open. Don't fall behind. 🏆`
          } else {
            message = `Hey ${firstName}! Two things still open: your reading and "${habit}". You've got this 💪`
          }
        } else if (needsHabit) {
          // Only habit outstanding
          if (tone === 'direct') {
            message = `${firstName}: "${habit}" not checked in today. Do it.`
          } else if (tone === 'gentle') {
            message = `Just a soft reminder ${firstName} — did you get to "${habit}" today? 🌱`
          } else if (tone === 'competitive') {
            message = `${firstName} — streak on the line. "${habit}" isn't checked yet. 🔥`
          } else {
            message = `Hey ${firstName} — don't forget to check in "${habit}" today! Keep that streak alive 🔥`
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

        const response = await fetch('https://api.onesignal.com/notifications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Key ${process.env.ONESIGNAL_API_KEY}`,
          },
          body: JSON.stringify({
            app_id: process.env.ONESIGNAL_APP_ID,
            include_aliases: { external_id: [participant.id] },
            target_channel: 'push',
            headings: { en: 'Breakthrough Table' },
            contents: { en: message },
            url: `${process.env.NEXT_PUBLIC_APP_URL}/tasks`,
          }),
        })

        return { id: participant.id, name: participant.full_name, message, status: response.status }
      })
  )

  // --- Scheduled reminders (no CTA, leader-configured message) ---
  const { data: reminderSettings } = await supabase
    .from('group_notification_settings')
    .select('group_id, reminder_enabled, reminder_time, reminder_message, checkin_timezone')
    .eq('reminder_enabled', true)
    .not('reminder_message', 'is', null)

  const reminderResults: any[] = []

  if (reminderSettings && reminderSettings.length > 0) {
    for (const setting of reminderSettings) {
      const utcTime = localTimeToUTC(setting.reminder_time, setting.checkin_timezone || 'America/Chicago')
      if (!timeWindow.includes(utcTime)) continue

      const { data: groupParticipants } = await supabase
        .from('profiles')
        .select('id, full_name, onesignal_id')
        .eq('group_id', setting.group_id)
        .eq('role', 'participant')
        .not('onesignal_id', 'is', null)

      if (!groupParticipants) continue

      for (const p of groupParticipants) {
        const res = await fetch('https://api.onesignal.com/notifications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Key ${process.env.ONESIGNAL_API_KEY}`,
          },
          body: JSON.stringify({
            app_id: process.env.ONESIGNAL_APP_ID,
            include_aliases: { external_id: [p.id] },
            target_channel: 'push',
            headings: { en: 'Breakthrough Table' },
            contents: { en: setting.reminder_message },
            // No url — pure message, no action
          }),
        })
        reminderResults.push({ id: p.id, name: p.full_name, status: res.status })
      }
    }
  }

  return NextResponse.json({
    nudges_sent: results.length,
    reminders_sent: reminderResults.length,
    results,
    reminderResults,
  })
}
