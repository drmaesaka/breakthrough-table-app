import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'

// Events, for the admin tab, via the service key. A leader reported posting
// an event and the tab still saying "No events yet": the browser insert and
// read of `events` both depend on console-only RLS policies that were written
// when every event belonged to one table and its original TC. Now events
// are BT-wide by default (group_id null) and co-leaders post them, and the
// browser path could not be trusted to show or accept either.
//
// A leader sees community-wide events plus those of tables they lead, and
// may post to either.

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const mine = await leaderGroupIds(auth.userId)
  const { data, error } = await adminClient().from('events').select('*').order('event_date', { ascending: true })
  if (error) return NextResponse.json({ error: 'Could not load events' }, { status: 500 })
  return NextResponse.json({ events: (data || []).filter(e => !e.group_id || mine.includes(e.group_id)) })
}

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await req.json().catch(() => ({}))
  const { title, description, event_date, event_type, location, virtual_link, group_id } = body
  if (!title?.trim() || !event_date) return NextResponse.json({ error: 'title and event_date are required' }, { status: 400 })
  if (group_id) {
    const mine = await leaderGroupIds(auth.userId)
    if (!mine.includes(group_id)) return NextResponse.json({ error: 'You can only limit an event to a table you lead' }, { status: 403 })
  }
  const { data, error } = await adminClient().from('events').insert({
    title: String(title).trim(),
    description: description || null,
    event_date,
    event_type: event_type === 'virtual' ? 'virtual' : 'in_person',
    location: location || null,
    virtual_link: virtual_link || null,
    created_by: auth.userId,
    group_id: group_id || null,
  }).select().single()
  if (error) return NextResponse.json({ error: 'Could not add the event', detail: error.message }, { status: 500 })
  return NextResponse.json({ event: data })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const supabase = adminClient()
  const { data: ev } = await supabase.from('events').select('id, group_id').eq('id', id).maybeSingle()
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (ev.group_id) {
    const mine = await leaderGroupIds(auth.userId)
    if (!mine.includes(ev.group_id)) return NextResponse.json({ error: 'That event belongs to another table' }, { status: 403 })
  }
  await supabase.from('event_rsvps').delete().eq('event_id', id)
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not delete', detail: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
