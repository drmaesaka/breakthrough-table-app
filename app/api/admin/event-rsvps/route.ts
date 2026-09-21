import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'

// Who signed up for which event, for the admin events tab. Service key,
// because a leader reading other members' RSVP rows from the browser is
// filtered by RLS to their own. A leader may see RSVPs for community-wide
// events (no group_id) and for events belonging to a table they lead.
//
// GET ?event_id=<id>          → one event's roster
// GET (no params)             → counts for every event the caller may see

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = adminClient()
  const mine = await leaderGroupIds(auth.userId)
  const eventId = req.nextUrl.searchParams.get('event_id')

  if (eventId) {
    const { data: ev } = await supabase.from('events').select('id, group_id').eq('id', eventId).maybeSingle()
    if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (ev.group_id && !mine.includes(ev.group_id)) {
      return NextResponse.json({ error: "That event belongs to another table" }, { status: 403 })
    }
    const { data, error } = await supabase
      .from('event_rsvps')
      .select('user_id, created_at, profiles!event_rsvps_user_id_fkey(full_name, contact_email, group_id, groups(name))')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
    if (error) {
      // If the FK is named differently, fall back to an unhinted embed.
      const retry = await supabase
        .from('event_rsvps')
        .select('user_id, created_at, profiles(full_name, contact_email, group_id, groups(name))')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true })
      if (retry.error) return NextResponse.json({ error: 'Could not load sign-ups', detail: retry.error.message }, { status: 500 })
      return NextResponse.json({ rsvps: shape(retry.data) })
    }
    return NextResponse.json({ rsvps: shape(data) })
  }

  // Counts for every event this leader may see.
  const { data: events } = await supabase.from('events').select('id, group_id')
  const visible = (events || []).filter(e => !e.group_id || mine.includes(e.group_id)).map(e => e.id)
  if (!visible.length) return NextResponse.json({ counts: {} })
  const { data: rows, error } = await supabase.from('event_rsvps').select('event_id').in('event_id', visible)
  if (error) return NextResponse.json({ error: 'Could not load sign-ups' }, { status: 500 })
  const counts: Record<string, number> = {}
  for (const r of rows || []) counts[r.event_id] = (counts[r.event_id] || 0) + 1
  return NextResponse.json({ counts })
}

function shape(rows: any[] | null) {
  return (rows || []).map(r => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    const g = p?.groups ? (Array.isArray(p.groups) ? p.groups[0] : p.groups) : null
    return {
      user_id: r.user_id,
      signed_up_at: r.created_at,
      full_name: p?.full_name || 'Unnamed',
      email: p?.contact_email || '',
      table: g?.name || null,
    }
  })
}
