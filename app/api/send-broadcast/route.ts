import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership, leaderGroupIds } from '@/lib/api-auth'
import { notifyMembers } from '@/lib/notify'

export const maxDuration = 60

// A leader's one-off announcement. Three audiences:
//   table — everyone seated at one table the caller leads (the original)
//   mine  — everyone at every table the caller leads
//   all   — every member of Breakthrough Table who has a table
// Push where a member has a device, email where not, never both.
//
// "all" is open to any leader: the role is app-wide and the people asking
// for it are the TCs. The admin screen makes them confirm before sending.

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id, message, scope: rawScope } = await req.json().catch(() => ({}))
  const scope: 'table' | 'mine' | 'all' = rawScope === 'all' || rawScope === 'mine' ? rawScope : 'table'
  if (!message?.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  const supabase = adminClient()
  let query = supabase.from('profiles').select('id')

  if (scope === 'table') {
    if (!group_id) return NextResponse.json({ error: 'group_id is required' }, { status: 400 })
    // Checking the leader role alone let any leader push a notification to any
    // table in the app. The role is app-wide; ownership of this group is not.
    const owns = await requireGroupOwnership(auth.userId, group_id)
    if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })
    query = query.eq('group_id', group_id)
  } else if (scope === 'mine') {
    const mine = await leaderGroupIds(auth.userId)
    if (!mine.length) return NextResponse.json({ message: 'You lead no tables', sent: 0, emailed: 0, recipients: 0 })
    query = query.in('group_id', mine)
  } else {
    // Members without a table (alumni, not yet seated) are left out: a table
    // announcement means nothing to them and they cannot act on it.
    query = query.not('group_id', 'is', null)
  }

  const { data: members, error: membersError } = await query
  if (membersError) return NextResponse.json({ error: 'Could not load members' }, { status: 500 })

  // The sender does not need their own announcement.
  const recipientIds = (members || []).map((m: any) => m.id).filter((id: string) => id !== auth.userId)
  if (!recipientIds.length) return NextResponse.json({ message: 'Nobody to send to', sent: 0, emailed: 0, recipients: 0 })

  const result = await notifyMembers(supabase, {
    kind: 'broadcast',
    recipientIds,
    title: scope === 'all' ? '📣 Breakthrough Table' : '📣 From your TC',
    body: message.trim(),
    url: '/dashboard',
    emailFallback: true,
    emailCta: 'Open Breakthrough Table',
  })
  return NextResponse.json({ sent: result.pushed, emailed: result.emailed, recipients: recipientIds.length, scope })
}
