import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser, leaderGroupIds } from '@/lib/api-auth'
import { tablesOf } from '@/lib/memberships'

// "I'm going" on an app event (2026-10-29). Server-side because cancelling was
// a browser delete that a console policy could filter to zero rows: the button
// flipped back while the RSVP stayed in the headcount.
// POST { event_id, going: boolean }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { event_id, going } = await req.json().catch(() => ({}))
  if (typeof event_id !== 'string') return NextResponse.json({ error: 'Bad event' }, { status: 400 })
  const admin = adminClient()
  const { data: ev } = await admin.from('events').select('id, group_id').eq('id', event_id).maybeSingle()
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  // BT-wide events (no table) are open to everyone; a table's own only to its people.
  if (ev.group_id) {
    const mine = [...await tablesOf(auth.userId), ...await leaderGroupIds(auth.userId)]
    if (!mine.includes(ev.group_id)) return NextResponse.json({ error: 'Not your event' }, { status: 403 })
  }
  const { error } = going
    ? await admin.from('event_rsvps').insert({ event_id, user_id: auth.userId })
    : await admin.from('event_rsvps').delete().eq('event_id', event_id).eq('user_id', auth.userId)
  if (error && error.code !== '23505') return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
