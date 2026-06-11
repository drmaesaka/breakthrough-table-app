import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  // Verify the caller is a logged-in leader
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.replace('Bearer ', '')
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: { user } } = await userClient.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (prof?.role !== 'leader') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { group_id, message } = await req.json()
  if (!group_id || !message?.trim()) {
    return NextResponse.json({ error: 'group_id and message are required' }, { status: 400 })
  }

  // Get all participants in the group
  const { data: participants } = await supabase
    .from('profiles')
    .select('id, full_name, onesignal_id')
    .eq('group_id', group_id)
    .eq('role', 'participant')
    .not('onesignal_id', 'is', null)

  if (!participants || participants.length === 0) {
    return NextResponse.json({ message: 'No participants to notify', sent: 0 })
  }

  const results = await Promise.all(
    participants.map(async (p: any) => {
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
          contents: { en: message.trim() },
          // No url — pure notification, no CTA
        }),
      })
      return { id: p.id, name: p.full_name, status: response.status }
    })
  )

  return NextResponse.json({ sent: results.length, results })
}
