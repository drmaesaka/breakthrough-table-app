import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser, leaderGroupIds } from '@/lib/api-auth'
import { notifyMembers, notifyTableChat, tableAudience, BURST_WINDOW_MS, type NotifyKind } from '@/lib/notify'

export const maxDuration = 60

// "I just wrote this row — tell the people it concerns." The browser calls
// this right after its own insert. The row is re-read with the service key
// and must be the caller's own and fresh, so the route cannot be used to
// re-broadcast old rows or someone else's.

const FRESH_MS = 2 * 60 * 1000

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { kind, id } = await req.json().catch(() => ({}))
  if (!id || !['chat', 'dm', 'task', 'prompt', 'content'].includes(kind)) {
    return NextResponse.json({ error: 'kind and id are required' }, { status: 400 })
  }
  const admin = adminClient()
  const fresh = (createdAt: string) => Date.now() - new Date(createdAt).getTime() < FRESH_MS

  if (kind === 'chat') {
    const { data: m } = await admin.from('messages').select('id, group_id, user_id, content, created_at').eq('id', id).maybeSingle()
    if (!m || m.user_id !== auth.userId || !fresh(m.created_at)) return NextResponse.json({ error: 'Not your fresh message' }, { status: 403 })
    return NextResponse.json(await notifyTableChat(admin, m))
  }

  if (kind === 'dm') {
    const { data: m } = await admin.from('direct_messages').select('id, conversation_id, sender_id, content, created_at').eq('id', id).maybeSingle()
    if (!m || m.sender_id !== auth.userId || !fresh(m.created_at)) return NextResponse.json({ error: 'Not your fresh message' }, { status: 403 })
    const since = new Date(new Date(m.created_at).getTime() - BURST_WINDOW_MS).toISOString()
    const { data: prior } = await admin.from('direct_messages').select('id')
      .eq('conversation_id', m.conversation_id).eq('sender_id', m.sender_id).neq('id', m.id)
      .gte('created_at', since).lt('created_at', m.created_at).limit(1)
    if (prior && prior.length) return NextResponse.json({ pushed: 0, emailed: 0, burst: true })
    const [{ data: convo }, { data: sender }] = await Promise.all([
      admin.from('dm_conversations').select('participant_1, participant_2').eq('id', m.conversation_id).maybeSingle(),
      admin.from('profiles').select('full_name').eq('id', m.sender_id).maybeSingle(),
    ])
    if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    const other = convo.participant_1 === m.sender_id ? convo.participant_2 : convo.participant_1
    return NextResponse.json(await notifyMembers(admin, {
      kind: 'dm',
      recipientIds: [other],
      title: `✉️ ${sender?.full_name || 'New message'}`,
      body: m.content.slice(0, 140),
      url: `/dm/${m.conversation_id}`,
      emailFallback: true,
      emailCta: 'Reply in the app',
    }))
  }

  // Leader-posted content. The row must belong to a table the caller leads.
  const table = kind === 'task' ? 'tasks' : kind === 'prompt' ? 'journal_prompts' : 'content'
  const textCol = kind === 'prompt' ? 'prompt' : 'title'
  const { data: row } = await admin.from(table).select(`id, group_id, created_at, ${textCol}`).eq('id', id).maybeSingle()
  if (!row || !fresh((row as any).created_at)) return NextResponse.json({ error: 'Not a fresh item' }, { status: 403 })
  const mine = await leaderGroupIds(auth.userId)
  if (!mine.includes((row as any).group_id)) return NextResponse.json({ error: 'Not your table' }, { status: 403 })

  const text = String((row as any)[textCol] || '').slice(0, 140)
  const copy: Record<Exclude<NotifyKind, 'chat' | 'dm'>, { title: string; url: string; cta: string }> = {
    task: { title: '📚 New reading & resources', url: '/tasks', cta: 'See it on My Tasks' },
    prompt: { title: '✍️ New reflection prompt', url: '/journal', cta: 'Write your reflection' },
    content: { title: '📖 New in the Library', url: '/library', cta: 'Open the Library' },
  }
  const c = copy[kind as 'task' | 'prompt' | 'content']
  const recipientIds = await tableAudience(admin, (row as any).group_id, auth.userId)
  return NextResponse.json(await notifyMembers(admin, {
    kind, recipientIds, title: c.title, body: text, url: c.url, emailFallback: true, emailCta: c.cta,
  }))
}
