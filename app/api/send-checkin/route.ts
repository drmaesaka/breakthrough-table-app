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

  const now = new Date()

  // Build 30-min UTC window
  const timeWindow: string[] = []
  for (let offset = 0; offset < 30; offset++) {
    const d = new Date(now.getTime() - offset * 60 * 1000)
    const h = d.getUTCHours().toString().padStart(2, '0')
    const m = d.getUTCMinutes() < 30 ? '00' : '30'
    const t = `${h}:${m}`
    if (!timeWindow.includes(t)) timeWindow.push(t)
  }

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
    } catch {
      return localTime
    }
  }

  // Get all groups with check-in notifications enabled
  const { data: settings } = await supabase
    .from('group_notification_settings')
    .select('group_id, checkin_enabled, checkin_time, checkin_timezone')
    .eq('checkin_enabled', true)

  if (!settings || settings.length === 0) {
    return NextResponse.json({ message: 'No check-in settings configured' })
  }

  // Filter to groups whose check-in time falls in current window
  const activeGroups = settings.filter((s: any) => {
    const utcTime = localTimeToUTC(s.checkin_time, s.checkin_timezone || 'America/Chicago')
    return timeWindow.includes(utcTime)
  })

  if (activeGroups.length === 0) {
    return NextResponse.json({ message: 'No groups scheduled for this window' })
  }

  const groupIds = activeGroups.map((s: any) => s.group_id)

  // Get all participants in those groups
  const { data: participants } = await supabase
    .from('profiles')
    .select('id, full_name, onesignal_id')
    .in('group_id', groupIds)
    .eq('role', 'participant')
    .not('onesignal_id', 'is', null)

  if (!participants || participants.length === 0) {
    return NextResponse.json({ message: 'No participants to notify' })
  }

  const results = await Promise.all(
    participants.map(async (p: any) => {
      const firstName = p.full_name?.split(' ')[0] || 'there'
      const message = `Hey ${firstName} — time to check in your habit and reading for today! 📋`

      const response = await fetch('https://api.onesignal.com/notifications', {
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
          contents: { en: message },
          url: `${process.env.NEXT_PUBLIC_APP_URL}/tasks`,
        }),
      })

      return { id: p.id, name: p.full_name, status: response.status }
    })
  )

  return NextResponse.json({ sent: results.length, results })
}
