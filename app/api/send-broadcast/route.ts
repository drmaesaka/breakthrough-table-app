import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/send-push'

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

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

  // Get all members in the group
  const { data: members } = await supabase
    .from('profiles')
    .select('id')
    .eq('group_id', group_id)

  if (!members || members.length === 0) {
    return NextResponse.json({ message: 'No members in group', sent: 0 })
  }

  const memberIds = members.map((m: any) => m.id)

  // Get their push subscriptions
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', memberIds)

  if (!subs || subs.length === 0) {
    return NextResponse.json({ message: 'No push subscriptions found', sent: 0 })
  }

  const results = await Promise.all(
    subs.map(async (sub: any) => {
      const result = await sendPush(sub, {
        title: 'Breakthrough Table',
        body: message.trim(),
      })
      if (result === 'expired') {
        await supabase.from('push_subscriptions').delete().eq('user_id', sub.user_id)
      }
      return result
    })
  )

  const sent = results.filter(r => r === true).length
  return NextResponse.json({ sent, total: subs.length })
}
