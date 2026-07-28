import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/send-push'

// Sends a test push to the calling user's own device only. Any signed-in
// member may call this — it can never reach anyone else's subscription.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.slice('Bearer '.length)
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user } } = await userClient.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
  const { data: sub, error } = await admin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Could not look up subscription' }, { status: 500 })
  }
  if (!sub) {
    return NextResponse.json(
      { error: 'No push subscription on file — enable notifications on this device first' },
      { status: 404 }
    )
  }

  const result = await sendPush(sub, {
    title: 'Breakthrough Table',
    body: 'Test notification — push is working on this device 🎉',
    url: '/preferences',
  })

  if (result === 'expired') {
    await admin.from('push_subscriptions').delete().eq('user_id', user.id)
    return NextResponse.json(
      { error: 'Subscription expired — tap Allow Notifications again to re-enable' },
      { status: 410 }
    )
  }
  if (result !== true) {
    return NextResponse.json({ error: 'Push service rejected the send' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
