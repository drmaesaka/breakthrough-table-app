import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// Upcoming events for a member: BT-wide ones (no group_id) plus their own
// table's. Served with the service key so visibility does not hinge on a
// console-only policy written when every event belonged to one table.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const supabase = adminClient()
  const [{ data: prof }, { data: events, error }, { data: rsvps }] = await Promise.all([
    supabase.from('profiles').select('group_id').eq('id', auth.userId).maybeSingle(),
    supabase.from('events').select('*').gte('event_date', new Date().toISOString()).order('event_date', { ascending: true }),
    supabase.from('event_rsvps').select('event_id').eq('user_id', auth.userId),
  ])
  if (error) return NextResponse.json({ error: 'Could not load events' }, { status: 500 })
  const gid = prof?.group_id || null
  return NextResponse.json({
    events: (events || []).filter(e => !e.group_id || e.group_id === gid),
    rsvp_event_ids: (rsvps || []).map(r => r.event_id),
  })
}
