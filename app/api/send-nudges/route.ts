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

  // Get participants with their preferences and habit info
  const { data: participants } = await supabase
    .from('profiles')
    .select('id, full_name, onesignal_id, group_id, adherence_percent, current_habit, nudge_preferences(enabled, tone)')
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
        return !habitDoneSet.has(p.id) || !readingDoneSet.has(p.id)
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

  return NextResponse.json({ sent: results.length, results })
}
