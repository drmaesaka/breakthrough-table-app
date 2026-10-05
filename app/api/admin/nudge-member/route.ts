import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'
import { notifyMembers } from '@/lib/notify'

// A TC's personal nudge to one member, from the member's card on My Table.
// Push where they have it, email where not. Like a broadcast it ignores the
// member's notification switches: it is a person writing to a person.
// Only members seated at a table the caller leads.

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { user_id, message } = await req.json().catch(() => ({}))
  const text = typeof message === 'string' ? message.trim() : ''
  if (!user_id || !text) return NextResponse.json({ error: 'user_id and message are required' }, { status: 400 })
  if (text.length > 500) return NextResponse.json({ error: 'Keep it under 500 characters' }, { status: 400 })
  if (user_id === auth.userId) return NextResponse.json({ error: 'You cannot nudge yourself' }, { status: 400 })

  const supabase = adminClient()
  const [{ data: target }, { data: sender }, mine] = await Promise.all([
    supabase.from('profiles').select('id, group_id, full_name').eq('id', user_id).maybeSingle(),
    supabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle(),
    leaderGroupIds(auth.userId),
  ])
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!target.group_id || !mine.includes(target.group_id)) {
    return NextResponse.json({ error: 'You can only nudge members at tables you lead' }, { status: 403 })
  }

  const from = (sender?.full_name || 'Your TC').split(' ')[0]
  const result = await notifyMembers(supabase, {
    kind: 'broadcast',
    recipientIds: [user_id],
    title: `👋 ${from} (your TC)`,
    body: text,
    url: '/dashboard',
    emailFallback: true,
    emailCta: 'Open Breakthrough Table',
  })
  return NextResponse.json({ pushed: result.pushed, emailed: result.emailed })
}
