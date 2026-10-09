import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser, leaderGroupIds } from '@/lib/api-auth'
import { REACTION_EMOJIS, type ReactionChat } from '@/lib/reactions'

// Reactions on chat messages (2026-10-09). Service key only — the table has
// no RLS policies — so every call first narrows the message ids to ones this
// person can see in that chat.
//
// POST { chat, ids }                → { reactions: { [messageId]: [{ emoji, count, mine, names }] } }
// POST { chat, id, emoji, toggle }  → adds or removes the caller's reaction, then the same for that id

const CHATS: Record<ReactionChat, string> = {
  table: 'messages', room: 'chat_room_messages', direct: 'direct_messages', leaders: 'leader_messages',
}

async function visibleIds(chat: ReactionChat, ids: string[], userId: string, role: string): Promise<string[]> {
  if (!ids.length) return []
  const admin = adminClient()
  if (chat === 'leaders') {
    if (role !== 'leader') return []
    const { data } = await admin.from('leader_messages').select('id').in('id', ids)
    return (data || []).map(r => r.id)
  }
  if (chat === 'table') {
    const [{ data: prof }, led] = await Promise.all([
      admin.from('profiles').select('group_id').eq('id', userId).maybeSingle(),
      role === 'leader' ? leaderGroupIds(userId) : Promise.resolve([] as string[]),
    ])
    const mine = new Set<string>([...(prof?.group_id ? [prof.group_id] : []), ...led])
    const { data } = await admin.from('messages').select('id, group_id').in('id', ids)
    return (data || []).filter(r => mine.has(r.group_id)).map(r => r.id)
  }
  if (chat === 'room') {
    const [{ data: rows }, { data: rooms }] = await Promise.all([
      admin.from('chat_room_messages').select('id, room_id').in('id', ids),
      admin.from('chat_room_members').select('room_id').eq('user_id', userId),
    ])
    const mine = new Set((rooms || []).map(r => r.room_id))
    return (rows || []).filter(r => mine.has(r.room_id)).map(r => r.id)
  }
  const { data: rows } = await admin.from('direct_messages').select('id, conversation_id').in('id', ids)
  const convIds = [...new Set((rows || []).map(r => r.conversation_id))]
  if (!convIds.length) return []
  const { data: convs } = await admin.from('dm_conversations').select('id')
    .in('id', convIds).or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
  const mine = new Set((convs || []).map(c => c.id))
  return (rows || []).filter(r => mine.has(r.conversation_id)).map(r => r.id)
}

async function summarize(chat: ReactionChat, ids: string[], userId: string) {
  const out: Record<string, { emoji: string; count: number; mine: boolean; names: string[] }[]> = {}
  if (!ids.length) return out
  const { data, error } = await adminClient().from('message_reactions')
    .select('message_id, emoji, user_id, created_at, profiles(full_name)')
    .eq('chat', chat).in('message_id', ids).order('created_at')
  if (error) throw error
  for (const r of data || []) {
    const list = out[r.message_id] ??= []
    let e = list.find(x => x.emoji === r.emoji)
    if (!e) { e = { emoji: r.emoji, count: 0, mine: false, names: [] }; list.push(e) }
    e.count++
    if (r.user_id === userId) e.mine = true
    e.names.push(r.user_id === userId ? 'You' : ((r.profiles as any)?.full_name || 'Someone'))
  }
  return out
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await req.json().catch(() => ({}))
  const chat = body.chat as ReactionChat
  if (!CHATS[chat]) return NextResponse.json({ error: 'Unknown chat' }, { status: 400 })

  try {
    if (body.toggle) {
      const id = String(body.id || '')
      const emoji = String(body.emoji || '')
      if (!REACTION_EMOJIS.includes(emoji)) return NextResponse.json({ error: 'Unknown reaction' }, { status: 400 })
      const [ok] = await visibleIds(chat, [id], auth.userId, auth.role)
      if (!ok) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      const admin = adminClient()
      const { data: had } = await admin.from('message_reactions').select('id')
        .eq('chat', chat).eq('message_id', id).eq('user_id', auth.userId).eq('emoji', emoji).maybeSingle()
      const { error } = had
        ? await admin.from('message_reactions').delete().eq('id', had.id)
        : await admin.from('message_reactions').insert({ chat, message_id: id, user_id: auth.userId, emoji })
      if (error) throw error
      return NextResponse.json({ reactions: await summarize(chat, [id], auth.userId) })
    }
    const ids: string[] = Array.isArray(body.ids) ? body.ids.slice(0, 300).map(String) : []
    const ok = await visibleIds(chat, ids, auth.userId, auth.role)
    return NextResponse.json({ reactions: await summarize(chat, ok, auth.userId) })
  } catch (err: any) {
    // Before the migration runs: no reactions, rather than an error in every chat.
    if (/message_reactions/.test(err?.message || '')) return NextResponse.json({ reactions: {}, note: 'not set up' })
    console.error('reactions failed:', err?.message || err)
    return NextResponse.json({ error: 'Could not load reactions' }, { status: 500 })
  }
}
