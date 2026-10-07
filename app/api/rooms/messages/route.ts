import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'
import { notifyRoom } from '@/lib/notify'
import { isOwnChatPhoto } from '@/lib/chat-photo'

// Messages in a custom group chat. Newest 200 on first load, only newer
// rows on each poll after — the same shape as table chat.

async function membership(admin: any, roomId: string, userId: string) {
  const { data } = await admin.from('chat_room_members').select('room_id').eq('room_id', roomId).eq('user_id', userId).maybeSingle()
  return Boolean(data)
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const roomId = req.nextUrl.searchParams.get('room_id') || ''
  const after = req.nextUrl.searchParams.get('after') || ''
  if (!roomId) return NextResponse.json({ error: 'room_id is required' }, { status: 400 })
  const admin = adminClient()
  if (!(await membership(admin, roomId, auth.userId))) return NextResponse.json({ error: 'Not in this group' }, { status: 403 })

  const base = admin.from('chat_room_messages')
    .select('*, profiles!chat_room_messages_user_id_fkey(full_name, avatar_url)')
    .eq('room_id', roomId)
  const { data, error } = after
    ? await base.gt('created_at', after).order('created_at', { ascending: true })
    : await base.order('created_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: 'Could not load messages' }, { status: 500 })

  const [{ data: room }, { data: members }] = after ? [{ data: null }, { data: null }] : await Promise.all([
    admin.from('chat_rooms').select('id, name').eq('id', roomId).maybeSingle(),
    admin.from('chat_room_members').select('user_id, profiles!chat_room_members_user_id_fkey(full_name, avatar_url)').eq('room_id', roomId),
  ])
  return NextResponse.json({
    messages: after ? data : [...(data || [])].reverse(),
    room,
    members: (members || []).map((m: any) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return { user_id: m.user_id, full_name: p?.full_name || 'Member', avatar_url: p?.avatar_url || null }
    }),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { room_id, content, image_url } = await req.json().catch(() => ({}))
  const text = typeof content === 'string' ? content.trim() : ''
  if (image_url && !isOwnChatPhoto(image_url, auth.userId)) return NextResponse.json({ error: 'Bad photo' }, { status: 400 })
  const photo = image_url ? String(image_url) : null
  if (!room_id || (!text && !photo)) return NextResponse.json({ error: 'room_id and content are required' }, { status: 400 })
  const admin = adminClient()
  if (!(await membership(admin, room_id, auth.userId))) return NextResponse.json({ error: 'Not in this group' }, { status: 403 })
  const { data: row, error } = await admin.from('chat_room_messages')
    .insert({ room_id, user_id: auth.userId, content: text, ...(photo ? { image_url: photo } : {}) })
    .select('id, room_id, user_id, content, created_at').single()
  if (error) return NextResponse.json({ error: 'Could not send', detail: error.message }, { status: 500 })
  try { await notifyRoom(admin, row) } catch (err) { console.error('room notify failed:', err) }
  return NextResponse.json({ ok: true })
}
