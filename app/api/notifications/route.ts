import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// The 🔔 inbox: my latest notifications and how many are unread.
// Rows are written by lib/notify.ts (sql/2026-10-06-notifications.sql).
// Before that migration the table is missing; answer empty rather than error,
// so the bell simply shows nothing.

const missing = (m: string) => /notifications/.test(m) && /not exist|schema cache/.test(m)

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = adminClient()
  const countOnly = new URL(req.url).searchParams.get('count') === '1'

  const { count, error: countError } = await admin.from('notifications')
    .select('id', { count: 'exact', head: true }).eq('user_id', auth.userId).is('read_at', null)
  if (countError) {
    if (missing(countError.message)) return NextResponse.json({ unread: 0, items: [] })
    return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 })
  }
  if (countOnly) return NextResponse.json({ unread: count || 0 })

  const { data, error } = await admin.from('notifications')
    .select('id, kind, title, body, url, created_at, read_at')
    .eq('user_id', auth.userId).order('created_at', { ascending: false }).limit(60)
  if (error) return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 })
  return NextResponse.json({ unread: count || 0, items: data || [] })
}

/** Mark read: { ids: [...] } for some, { all: true } for everything. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { ids, all } = await req.json().catch(() => ({}))
  let q = adminClient().from('notifications').update({ read_at: new Date().toISOString() })
    .eq('user_id', auth.userId).is('read_at', null)
  if (!all) {
    if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: 'ids or all is required' }, { status: 400 })
    q = q.in('id', ids.filter((x: unknown) => typeof x === 'string').slice(0, 200))
  }
  const { error } = await q
  if (error && !missing(error.message)) return NextResponse.json({ error: 'Could not update' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
