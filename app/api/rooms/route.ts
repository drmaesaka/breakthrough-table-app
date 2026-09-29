import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// Custom group chats (sql/2026-09-29-group-rooms.sql). Service key with
// membership checked here; the tables carry read policies only.

const MISSING = 'Group chats need the 2026-09-29 migration to be run in Supabase first'
const missing = (m: string) => /chat_room/.test(m) && /not exist|schema cache/.test(m)

async function isMember(admin: any, roomId: string, userId: string) {
  const { data } = await admin.from('chat_room_members').select('room_id').eq('room_id', roomId).eq('user_id', userId).maybeSingle()
  return Boolean(data)
}

/** My rooms, each with its people and last message. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = adminClient()

  const { data: mine, error } = await admin.from('chat_room_members').select('room_id').eq('user_id', auth.userId)
  if (error) return NextResponse.json({ error: missing(error.message) ? MISSING : 'Could not load groups' }, { status: missing(error.message) ? 409 : 500 })
  const ids = (mine || []).map(r => r.room_id)
  if (!ids.length) return NextResponse.json({ rooms: [] })

  const [{ data: rooms }, { data: members }, { data: lastMsgs }] = await Promise.all([
    admin.from('chat_rooms').select('id, name, created_by, created_at').in('id', ids),
    admin.from('chat_room_members').select('room_id, user_id, profiles!chat_room_members_user_id_fkey(full_name, avatar_url)').in('room_id', ids),
    admin.from('chat_room_messages').select('room_id, content, created_at, user_id').in('room_id', ids).order('created_at', { ascending: false }).limit(400),
  ])
  const byRoom = new Map<string, any[]>()
  for (const m of members || []) byRoom.set(m.room_id, [...(byRoom.get(m.room_id) || []), m])
  const last = new Map<string, any>()
  for (const m of lastMsgs || []) if (!last.has(m.room_id)) last.set(m.room_id, m)

  const out = (rooms || []).map(r => ({
    ...r,
    members: (byRoom.get(r.id) || []).map((m: any) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return { user_id: m.user_id, full_name: p?.full_name || 'Member', avatar_url: p?.avatar_url || null }
    }),
    last_message: last.get(r.id) || null,
  })).sort((a, b) => String(b.last_message?.created_at || b.created_at).localeCompare(String(a.last_message?.created_at || a.created_at)))
  return NextResponse.json({ rooms: out })
}

/** Create a room with me plus the chosen people. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { name, member_ids } = await req.json().catch(() => ({}))
  const others: string[] = [...new Set((Array.isArray(member_ids) ? member_ids : []).filter((x: unknown): x is string => typeof x === 'string' && x !== auth.userId))]
  if (!name?.trim()) return NextResponse.json({ error: 'Give the group a name' }, { status: 400 })
  if (!others.length) return NextResponse.json({ error: 'Pick at least one other person' }, { status: 400 })

  const admin = adminClient()
  const { data: valid } = await admin.from('profiles').select('id').in('id', others)
  const ids = (valid || []).map(p => p.id)
  if (!ids.length) return NextResponse.json({ error: 'Pick at least one other person' }, { status: 400 })

  const { data: room, error } = await admin.from('chat_rooms').insert({ name: String(name).trim().slice(0, 60), created_by: auth.userId }).select().single()
  if (error) return NextResponse.json({ error: missing(error.message) ? MISSING : 'Could not create the group' }, { status: missing(error.message) ? 409 : 500 })
  const { error: mErr } = await admin.from('chat_room_members').insert(
    [auth.userId, ...ids].map(user_id => ({ room_id: room.id, user_id, added_by: auth.userId }))
  )
  if (mErr) return NextResponse.json({ error: 'Could not add people', detail: mErr.message }, { status: 500 })
  return NextResponse.json({ room })
}

/** Add people to a room I am in. */
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { room_id, add } = await req.json().catch(() => ({}))
  if (!room_id || !Array.isArray(add) || !add.length) return NextResponse.json({ error: 'room_id and add are required' }, { status: 400 })
  const admin = adminClient()
  if (!(await isMember(admin, room_id, auth.userId))) return NextResponse.json({ error: 'Not in this group' }, { status: 403 })
  const { data: valid } = await admin.from('profiles').select('id').in('id', add)
  const rows = (valid || []).map(p => ({ room_id, user_id: p.id, added_by: auth.userId }))
  if (rows.length) {
    const { error } = await admin.from('chat_room_members').upsert(rows, { onConflict: 'room_id,user_id', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: 'Could not add people', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ added: rows.length })
}

/** Leave a room. The room goes when its last person leaves. */
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { room_id } = await req.json().catch(() => ({}))
  if (!room_id) return NextResponse.json({ error: 'room_id is required' }, { status: 400 })
  const admin = adminClient()
  await admin.from('chat_room_members').delete().eq('room_id', room_id).eq('user_id', auth.userId)
  const { count } = await admin.from('chat_room_members').select('user_id', { count: 'exact', head: true }).eq('room_id', room_id)
  if (!count) await admin.from('chat_rooms').delete().eq('id', room_id)
  return NextResponse.json({ ok: true })
}
