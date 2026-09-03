import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser, leaderGroupIds } from '@/lib/api-auth'
import { notifyTableChat } from '@/lib/notify'

// Table chat for a table the caller LEADS but does not sit at.
//
// A member's own table chat goes straight from the browser to Supabase and
// stays that way — polling every 3 seconds through a serverless function for
// every member would be needless load. This route exists for the one case
// RLS cannot be trusted with: a TC running two tables. The messages policies
// live only in the Supabase console and scope reads to the caller's own
// group_id, so a browser read of the other table would come back empty and
// look like an empty room. The service key makes the read real; the
// ownership check below makes it legal.

async function allowed(userId: string, groupId: string) {
  const supabase = adminClient()
  const { data: prof } = await supabase.from('profiles').select('group_id').eq('id', userId).maybeSingle()
  if (prof?.group_id === groupId) return true
  return (await leaderGroupIds(userId)).includes(groupId)
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const groupId = req.nextUrl.searchParams.get('group_id') || ''
  const after = req.nextUrl.searchParams.get('after') || ''
  if (!groupId) return NextResponse.json({ error: 'group_id is required' }, { status: 400 })
  if (!(await allowed(auth.userId, groupId))) {
    return NextResponse.json({ error: 'Not your table' }, { status: 403 })
  }

  const supabase = adminClient()
  // Same shape as the browser path: newest 200 on first load, only newer rows
  // on every poll after that.
  const query = supabase.from('messages').select('*, profiles(full_name, avatar_url)').eq('group_id', groupId)
  const { data, error } = after
    ? await query.gt('created_at', after).order('created_at', { ascending: true })
    : await query.order('created_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: 'Could not load messages' }, { status: 500 })

  return NextResponse.json({ messages: after ? data : [...(data || [])].reverse() })
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id, content } = await req.json().catch(() => ({}))
  const text = typeof content === 'string' ? content.trim() : ''
  if (!group_id || !text) return NextResponse.json({ error: 'group_id and content are required' }, { status: 400 })
  if (!(await allowed(auth.userId, group_id))) {
    return NextResponse.json({ error: 'Not your table' }, { status: 403 })
  }

  // user_id comes from the token, never the body.
  const admin = adminClient()
  const { data: row, error } = await admin
    .from('messages')
    .insert({ group_id, user_id: auth.userId, content: text })
    .select('id, group_id, user_id, content, created_at')
    .single()
  if (error) return NextResponse.json({ error: 'Could not send', detail: error.message }, { status: 500 })
  // Same ping the browser path sends; a failure here must not fail the send.
  try { await notifyTableChat(admin, row) } catch (err) { console.error('chat notify failed:', err) }
  return NextResponse.json({ ok: true })
}
