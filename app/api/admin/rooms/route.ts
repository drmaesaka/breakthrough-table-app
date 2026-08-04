import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership } from '@/lib/api-auth'

// Rooms are venue-wide records, so every write here uses the service key: the
// rooms table carries a SELECT policy and nothing else, and a browser-side
// INSERT filtered away by RLS returns 200 having changed nothing.
//
// Until 2026-08-03 rooms could only be created by hand in the Supabase table
// editor, which was survivable while Skedda was the real schedule. Now that
// this app IS the schedule, a room that only a developer can add is a room the
// venue cannot rent.
//
// A room with group_id NULL is shared by every table; a stamped room belongs to
// one. Creating or editing a stamped room requires owning that group, matching
// /api/admin/meeting-plans.

const ROOM_TYPES = ['conference_room', 'private_office'] as const
type RoomType = (typeof ROOM_TYPES)[number]

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t || null
}

/** Capacity is optional, but a stored 0 or a negative would render as "Up to 0". */
function cleanCapacity(v: unknown): number | null | undefined {
  if (v === null || v === '' || v === undefined) return null
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) return undefined
  return n
}

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Includes archived rooms on purpose — this is the management view, and a
  // room you cannot see is a room you cannot bring back.
  const { data, error } = await adminClient()
    .from('rooms')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('suite', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Could not load rooms', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ rooms: data || [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const name = cleanText(body.name)
  const suite = cleanText(body.suite)
  const roomType = body.room_type as RoomType

  if (!name) return NextResponse.json({ error: 'A room name is required' }, { status: 400 })
  if (!suite) return NextResponse.json({ error: 'A suite is required' }, { status: 400 })
  if (!ROOM_TYPES.includes(roomType)) {
    return NextResponse.json({ error: 'room_type must be conference_room or private_office' }, { status: 400 })
  }

  const capacity = cleanCapacity(body.capacity)
  if (capacity === undefined) {
    return NextResponse.json({ error: 'Capacity must be a whole number above zero' }, { status: 400 })
  }

  if (body.group_id) {
    const owns = await requireGroupOwnership(auth.userId, body.group_id)
    if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })
  }

  const { data, error } = await adminClient()
    .from('rooms')
    .insert({
      name,
      suite,
      room_type: roomType,
      capacity,
      description: cleanText(body.description),
      group_id: body.group_id || null,
      sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0,
      is_active: true,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Could not create the room', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ room: data })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const supabase = adminClient()
  const { data: existing, error: readError } = await supabase
    .from('rooms')
    .select('id, group_id')
    .eq('id', body.id)
    .maybeSingle()

  if (readError) {
    return NextResponse.json({ error: 'Could not load the room', detail: readError.message }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  // Checked against both the current owner and the proposed one, so a stamped
  // room cannot be moved out of a table you do not own, or into one.
  for (const gid of [existing.group_id, body.group_id]) {
    if (!gid) continue
    const owns = await requireGroupOwnership(auth.userId, gid)
    if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })
  }

  const patch: Record<string, unknown> = {}
  if ('name' in body) {
    const name = cleanText(body.name)
    if (!name) return NextResponse.json({ error: 'A room name is required' }, { status: 400 })
    patch.name = name
  }
  if ('suite' in body) {
    const suite = cleanText(body.suite)
    if (!suite) return NextResponse.json({ error: 'A suite is required' }, { status: 400 })
    patch.suite = suite
  }
  if ('room_type' in body) {
    if (!ROOM_TYPES.includes(body.room_type)) {
      return NextResponse.json({ error: 'room_type must be conference_room or private_office' }, { status: 400 })
    }
    patch.room_type = body.room_type
  }
  if ('capacity' in body) {
    const capacity = cleanCapacity(body.capacity)
    if (capacity === undefined) {
      return NextResponse.json({ error: 'Capacity must be a whole number above zero' }, { status: 400 })
    }
    patch.capacity = capacity
  }
  if ('description' in body) patch.description = cleanText(body.description)
  if ('group_id' in body) patch.group_id = body.group_id || null
  if ('sort_order' in body && Number.isInteger(body.sort_order)) patch.sort_order = body.sort_order
  if ('is_active' in body) patch.is_active = Boolean(body.is_active)

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('rooms')
    .update(patch)
    .eq('id', body.id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Could not update the room', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ room: data })
}

/**
 * Archives rather than deletes.
 *
 * room_bookings references rooms, so a hard delete either cascades real booking
 * history away or fails on the foreign key. Archiving keeps the record and the
 * history while removing the room from every booking grid.
 *
 * Upcoming bookings are reported back rather than silently cancelled — someone
 * is expecting that room, and the leader should be the one to tell them.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const supabase = adminClient()
  const { data: existing } = await supabase
    .from('rooms')
    .select('id, group_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  if (existing.group_id) {
    const owns = await requireGroupOwnership(auth.userId, existing.group_id)
    if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })
  }

  const today = new Date().toLocaleDateString('en-CA')
  const { count } = await supabase
    .from('room_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', id)
    .gte('booking_date', today)

  const { error } = await supabase.from('rooms').update({ is_active: false }).eq('id', id)
  if (error) {
    return NextResponse.json({ error: 'Could not archive the room', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, upcoming_bookings: count || 0 })
}
