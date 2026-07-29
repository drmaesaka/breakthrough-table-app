import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// One row per *device*, keyed by endpoint. This used to upsert on user_id, so
// enabling notifications on a second device silently replaced the first — the
// member's phone just stopped receiving nudges the day they set up their iPad.
//
// The insert-then-fallback shape below works with either database constraint:
// once the unique key is moved from user_id to endpoint (see
// sql/2026-07-29-multi-device-push.sql) a member accumulates one row per
// device; until then the fallback preserves the old replace-the-row behavior
// rather than erroring.
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
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user } } = await userClient.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const subscription = await req.json()
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: 'Malformed subscription' }, { status: 400 })
  }

  const row = {
    user_id: user.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    updated_at: new Date().toISOString(),
  }

  // Same device re-subscribing (permission re-granted, key rotation): refresh
  // its row in place.
  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('endpoint', row.endpoint)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('push_subscriptions')
      .update(row)
      .eq('endpoint', row.endpoint)
    if (error) {
      console.error('push_subscriptions update failed:', error.message, error.code)
      return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  const { error: insertError } = await supabase.from('push_subscriptions').insert(row)
  if (!insertError) return NextResponse.json({ ok: true })

  // 23505 on a fresh endpoint means the legacy one-row-per-user constraint is
  // still in place; fall back to replacing that row so subscribing keeps
  // working (with the old last-device-wins behavior) until the SQL is run.
  if (insertError.code === '23505') {
    const { error } = await supabase
      .from('push_subscriptions')
      .update(row)
      .eq('user_id', user.id)
    if (!error) return NextResponse.json({ ok: true, note: 'replaced existing device (run multi-device SQL to keep both)' })
    console.error('push_subscriptions fallback update failed:', error.message, error.code)
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  }

  console.error('push_subscriptions insert failed:', insertError.message, insertError.code)
  return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
}
