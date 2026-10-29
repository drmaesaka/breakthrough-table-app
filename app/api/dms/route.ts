import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'
import { isOwnChatPhoto } from '@/lib/chat-photo'

// The caller's direct-message conversations with the other person's name,
// photo and table, and the latest message (2026-10-28). Server-side because
// the browser's lookup of the other person (profiles + groups(name)) came
// back empty after Supabase stopped honouring auth.role() policies, and
// every conversation read "Member".
//
// GET            → { conversations: [{ id, created_at, otherId, other, lastMsg }] }
// GET ?id=<conv> → { conversation: { id, otherId, other } }   (one, for the thread header)

type Other = { full_name: string | null; avatar_url: string | null; group_id: string | null; groups: { name: string } | null }

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = adminClient()
  const one = new URL(req.url).searchParams.get('id')

  let q = admin.from('dm_conversations').select('id, participant_1, participant_2, created_at')
    .or(`participant_1.eq.${auth.userId},participant_2.eq.${auth.userId}`)
  if (one) q = q.eq('id', one)
  const { data: convos, error } = await q.order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'Could not load conversations' }, { status: 500 })

  const otherIds = [...new Set((convos || []).map(c => c.participant_1 === auth.userId ? c.participant_2 : c.participant_1))]
  const { data: profs } = otherIds.length
    ? await admin.from('profiles').select('id, full_name, avatar_url, group_id').in('id', otherIds)
    : { data: [] as any[] }
  const groupIds = [...new Set((profs || []).map(p => p.group_id).filter(Boolean))]
  const { data: groups } = groupIds.length ? await admin.from('groups').select('id, name').in('id', groupIds) : { data: [] as any[] }
  const groupName = new Map((groups || []).map(g => [g.id, g.name]))
  const other = new Map<string, Other>((profs || []).map(p => [p.id, {
    full_name: p.full_name, avatar_url: p.avatar_url, group_id: p.group_id,
    groups: p.group_id && groupName.has(p.group_id) ? { name: groupName.get(p.group_id) } : null,
  }]))

  const rows = (convos || []).map(c => {
    const otherId = c.participant_1 === auth.userId ? c.participant_2 : c.participant_1
    return { id: c.id, created_at: c.created_at, otherId, other: other.get(otherId) || null }
  })
  if (one) return rows.length ? NextResponse.json({ conversation: rows[0] }) : NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Latest message per conversation.
  const withLast = await Promise.all(rows.map(async r => {
    const { data: lastMsg } = await admin.from('direct_messages').select('content, created_at')
      .eq('conversation_id', r.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    return { ...r, lastMsg }
  }))
  return NextResponse.json({ conversations: withLast })
}

// Sending a direct message (2026-10-29). Server-side so a console policy on
// direct_messages cannot block it; the sender must be in the conversation.
// POST { conversation_id, content, image_url? } → { id }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { conversation_id, content, image_url } = await req.json().catch(() => ({}))
  const text = typeof content === 'string' ? content.trim() : ''
  const photo = isOwnChatPhoto(image_url, auth.userId) ? image_url : null
  if (image_url && !photo) return NextResponse.json({ error: 'Bad photo' }, { status: 400 })
  if (typeof conversation_id !== 'string' || (!text && !photo)) return NextResponse.json({ error: 'Write a message' }, { status: 400 })
  const admin = adminClient()
  const { data: convo } = await admin.from('dm_conversations').select('participant_1, participant_2').eq('id', conversation_id).maybeSingle()
  if (!convo || (convo.participant_1 !== auth.userId && convo.participant_2 !== auth.userId)) {
    return NextResponse.json({ error: 'Not your conversation' }, { status: 403 })
  }
  const { data, error } = await admin.from('direct_messages')
    .insert({ conversation_id, sender_id: auth.userId, content: text, ...(photo ? { image_url: photo } : {}) })
    .select('id').single()
  if (error) return NextResponse.json({ error: 'Could not send' }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
