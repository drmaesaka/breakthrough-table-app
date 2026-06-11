import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/send-push'

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
    } catch { return localTime }
  }

  const { data: settings } = await supabase
    .from('group_notification_settings')
    .select('group_id, checkin_enabled, checkin_time, checkin_timezone')
    .eq('checkin_enabled', true)

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

  if (!subs || subs.length === 0) {
    return NextResponse.json({ message: 'No push subscriptions found', sent: 0 })
  }

  const subMap = Object.fromEntries(subs.map((s: any) => [s.user_id, s]))

  const results = await Promise.all(
    participants.map(async (p: any) => {
      const sub = subMap[p.id]
      if (!sub) return null
      const firstName = p.full_name?.split(' ')[0] || 'there'
      const result = await sendPush(sub, {
        title: 'Breakthrough Table',
        body: `Hey ${firstName} — time to check in your habit and reading for today! 📋`,
        url: '/tasks',
      })
      if (result === 'expired') {
        await supabase.from('push_subscriptions').delete().eq('user_id', p.id)
      }
      return result
    })
  )

  const sent = results.filter(r => r === true).length
  return NextResponse.json({ sent })
}
