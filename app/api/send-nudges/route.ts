import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// This endpoint is called by n8n on a schedule
// It finds participants with incomplete tasks and sends them a push nudge

export async function POST(req: NextRequest) {
  // Verify secret so only n8n can call this
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.NUDGE_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  // Get all participants who are in a group, joined with their nudge preferences
  const { data: participants } = await supabase
    .from('profiles')
    .select('id, full_name, onesignal_id, group_id, adherence_percent, nudge_preferences(enabled, tone)')
    .eq('role', 'participant')
    .not('group_id', 'is', null)
    .not('onesignal_id', 'is', null)

  if (!participants || participants.length === 0) {
    return NextResponse.json({ message: 'No participants to nudge' })
  }

  // Only nudge people who: aren't at 100%, and haven't disabled nudges
  const toNudge = participants.filter(p => {
    const prefs = Array.isArray(p.nudge_preferences) ? p.nudge_preferences[0] : p.nudge_preferences
    if (prefs && prefs.enabled === false) return false
    return (p.adherence_percent || 0) < 100
  })

  const results = await Promise.all(
    toNudge.map(async (participant) => {
      const firstName = participant.full_name?.split(' ')[0] || 'there'
      const adherence = participant.adherence_percent || 0
      const prefs = Array.isArray(participant.nudge_preferences) ? participant.nudge_preferences[0] : participant.nudge_preferences
      const tone = prefs?.tone || 'encouraging'

      let message: string
      if (tone === 'direct') {
        message = adherence === 0
          ? `${firstName}: tasks not started. Get on it.`
          : adherence >= 75
          ? `${firstName}: ${adherence}% done. Close it out.`
          : `${firstName}: ${adherence}% this period. Keep moving.`
      } else if (tone === 'gentle') {
        message = adherence === 0
          ? `Hey ${firstName}, just a soft reminder — your tasks are ready when you are 🌱`
          : adherence >= 75
          ? `You're so close ${firstName}! ${adherence}% done — no rush, you've got this 😊`
          : `Just checking in ${firstName} — you're at ${adherence}%. Every little bit counts 💙`
      } else if (tone === 'competitive') {
        message = adherence === 0
          ? `${firstName} — your table is moving and you're at 0%. Time to compete. 🏆`
          : adherence >= 75
          ? `${firstName} at ${adherence}%! Don't let anyone catch you — FINISH IT. 🔥`
          : `${firstName}: ${adherence}% is not your ceiling. Push harder. 💪`
      } else {
        // encouraging (default)
        message = adherence === 0
          ? `Hey ${firstName} — your tasks are waiting! Start strong this period. 💪`
          : adherence >= 75
          ? `Almost there ${firstName}! You're at ${adherence}% — finish strong! 🔥`
          : `Hey ${firstName} — don't forget to check off your tasks! You're at ${adherence}% this period.`
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

      return { id: participant.id, name: participant.full_name, status: response.status }
    })
  )

  return NextResponse.json({ sent: results.length, results })
}
