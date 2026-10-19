import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser, leaderGroupIds } from '@/lib/api-auth'
import { notifyMembers } from '@/lib/notify'

// @mentions in the chats and Follow-ups (2026-10-19).
//
// GET  ?chat=&id=                       → { people }  who can be tagged there
//        table / followup: id = group_id   room: id = room_id
//        direct: id = conversation_id      leaders: no id
// POST { chat, message_id, user_ids }    → pings the people tagged in a
//        message the caller just sent ("followup" posts and "followup_reply"
//        replies use their own ids). Only people in that chat are pinged.

type Chat = 'table' | 'room' | 'direct' | 'leaders' | 'followup' | 'followup_reply'
type Person = { id: string; full_name: string; avatar_url: string | null }

/** Everyone in that chat, or null if the caller is not in it. */
async function peopleIn(chat: Chat, id: string, userId: string, role: string): Promise<Person[] | null> {
  const admin = adminClient()
  const profiles = async (ids: string[]) => {
    if (!ids.length) return []
    const { data } = await admin.from('profiles').select('id, full_name, avatar_url').in('id', [...new Set(ids)])
    return (data || []).map(p => ({ id: p.id, full_name: p.full_name || 'Member', avatar_url: p.avatar_url || null }))
  }
  if (chat === 'leaders') {
    if (role !== 'leader') return null
    const { data } = await admin.from('profiles').select('id').eq('role', 'leader')
    return profiles((data || []).map(p => p.id))
  }
  if (chat === 'room') {
    const { data } = await admin.from('chat_room_members').select('user_id').eq('room_id', id)
    const ids = (data || []).map(r => r.user_id)
    return ids.includes(userId) ? profiles(ids) : null
  }
  if (chat === 'direct') {
    const { data } = await admin.from('dm_conversations').select('participant_1, participant_2').eq('id', id).maybeSingle()
    if (!data || (data.participant_1 !== userId && data.participant_2 !== userId)) return null
    return profiles([data.participant_1, data.participant_2])
  }
  // A table's chat or Follow-ups: who sits there, plus its TCs.
  const [{ data: seated }, { data: legacy }, { data: joined }, { data: me }] = await Promise.all([
    admin.from('profiles').select('id').eq('group_id', id),
    admin.from('groups').select('leader_id').eq('id', id).maybeSingle(),
    admin.from('group_leaders').select('user_id').eq('group_id', id),
    admin.from('profiles').select('group_id').eq('id', userId).maybeSingle(),
  ])
  const ids = [...(seated || []).map(p => p.id), ...(legacy?.leader_id ? [legacy.leader_id] : []), ...(joined || []).map(j => j.user_id)]
  const allowed = me?.group_id === id || ids.includes(userId) || (role === 'leader' && (await leaderGroupIds(userId)).includes(id))
  return allowed ? profiles(ids) : null
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const url = new URL(req.url)
  const chat = url.searchParams.get('chat') as Chat
  const people = await peopleIn(chat, url.searchParams.get('id') || '', auth.userId, auth.role)
  if (!people) return NextResponse.json({ people: [] })
  return NextResponse.json({ people: people.filter(p => p.id !== auth.userId).sort((a, b) => a.full_name.localeCompare(b.full_name)) })
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const b = await req.json().catch(() => ({}))
  const chat = b.chat as Chat
  const wanted: string[] = Array.isArray(b.user_ids) ? b.user_ids.map(String).slice(0, 30) : []
  if (!wanted.length) return NextResponse.json({ notified: 0 })
  const admin = adminClient()

  // The message, its author, and where it lives.
  const table = { table: 'messages', room: 'chat_room_messages', direct: 'direct_messages', leaders: 'leader_messages', followup: 'table_posts', followup_reply: 'table_post_replies' }[chat]
  if (!table) return NextResponse.json({ error: 'Unknown chat' }, { status: 400 })
  const { data: msg } = await admin.from(table).select('*').eq('id', String(b.message_id || '')).maybeSingle()
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  const author = msg.sender_id || msg.user_id || msg.author_id
  if (author !== auth.userId) return NextResponse.json({ error: 'Not your message' }, { status: 403 })
  if (Date.now() - new Date(msg.created_at).getTime() > 10 * 60 * 1000) return NextResponse.json({ notified: 0 })

  let id = msg.group_id || msg.room_id || msg.conversation_id || ''
  if (chat === 'followup_reply') {
    const { data: post } = await admin.from('table_posts').select('group_id').eq('id', msg.post_id).maybeSingle()
    id = post?.group_id || ''
  }
  const people = await peopleIn(chat, id, auth.userId, auth.role) || []
  const targets = people.filter(p => wanted.includes(p.id) && p.id !== auth.userId).map(p => p.id)
  if (!targets.length) return NextResponse.json({ notified: 0 })

  const { data: me } = await admin.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle()
  const url = chat === 'room' ? `/chat/${id}` : chat === 'direct' ? `/dm/${id}` : chat === 'leaders' ? '/leaders'
    : chat === 'table' ? `/group?table=${id}` : `/group?table=${id}&tab=followups`
  await notifyMembers(admin, {
    kind: 'dm', recipientIds: targets,
    title: `@ ${me?.full_name || 'Someone'} tagged you`,
    body: String(msg.content ?? msg.body ?? msg.title ?? '').slice(0, 300) || 'Sent a photo',
    url, emailFallback: false,
  }).catch(err => console.error('mentions: notify failed:', err))
  return NextResponse.json({ notified: targets.length })
}
