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

  // Get all participants who are in a group
  const { data: participants } = await supabase
    .from('profiles')
    .select('id, full_name, onesignal_id, group_id, adherence_percent')
    .eq('role', 'participant')
    .not('group_id', 'is', null)
    .not('onesignal_id', 'is', null)

  if (!participants || participants.length === 0) {
    return NextResponse.json({ message: 'No participants to nudge' })
  }

  // Only nudge people who aren't at 100%
  const toNudge = participants.filter(p => (p.adherence_percent || 0) < 100)

  const results = await Promise.all(
    toNudge.map(async (participant) => {
      const firstName = participant.full_name?.split(' ')[0] || 'there'
      const adherence = participant.adherence_percent || 0

      let message = `Hey ${firstName} — don't forget to check off your tasks today! You're at ${adherence}% this period.`
      if (adherence === 0) {
        message = `Hey ${firstName} — your tasks are waiting! Start strong this period. 💪`
      } else if (adherence >= 75) {
        message = `Almost there ${firstName}! You're at ${adherence}% — finish strong! 🔥`
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
