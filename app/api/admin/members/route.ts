import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'

// `role = 'leader'` is app-wide, not per-table, so every handler here narrows to
// the caller's own groups. Without that narrowing any leader could read, reassign
// or delete any member of any table the moment a second table exists.
//
// Members with no group are included deliberately: someone who signed up without
// an invite link has no table yet, and the leader's only way to place them is to
// see them here. They are the one row set visible across tables.

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = adminClient()
  const myGroups = await leaderGroupIds(auth.userId)

  // `in.()` with an empty list is a PostgREST syntax error, so a leader who owns
  // no groups yet asks only for the unassigned rows.
  const scopeFilter = myGroups.length
    ? `group_id.is.null,group_id.in.(${myGroups.join(',')})`
    : 'group_id.is.null'

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, group_id, role, adherence_percent, streak')
    .or(scopeFilter)
    .order('full_name', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })

  // A member with no push subscription silently receives nothing — the leader
  // has no other way to tell them apart from a member who is simply never due.
  const memberIds = (data || []).map(m => m.id)
  const { data: subs } = memberIds.length
    ? await supabase.from('push_subscriptions').select('user_id').in('user_id', memberIds)
    : { data: [] as { user_id: string }[] }
  const subscribed = new Set((subs || []).map((s: any) => s.user_id))

  const members = (data || []).map(m => ({ ...m, push_enabled: subscribed.has(m.id) }))
  return NextResponse.json({ members, group_ids: myGroups })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { userId, groupId, role } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  if (role !== undefined && role !== 'leader' && role !== 'participant') {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  // Guard against a lone leader demoting themselves and locking everyone out of admin.
  if (role === 'participant' && userId === auth.userId) {
    return NextResponse.json({ error: 'You cannot demote yourself' }, { status: 400 })
  }

  const supabase = adminClient()
  const myGroups = await leaderGroupIds(auth.userId)

  const scope = await memberInScope(userId, myGroups)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

  // Reassignment can only ever move a member into a table the caller owns —
  // otherwise a leader could hand their own member to someone else's table.
  if (groupId !== undefined && groupId !== null && groupId !== '' && !myGroups.includes(groupId)) {
    return NextResponse.json({ error: 'Not the leader of that group' }, { status: 403 })
  }

  const updates: Record<string, unknown> = {}
  if (groupId !== undefined) updates.group_id = groupId || null
  if (role !== undefined) updates.role = role
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await supabase.from('profiles').update(updates).eq('id', userId)
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  if (userId === auth.userId) {
    return NextResponse.json({ error: 'You cannot delete yourself' }, { status: 400 })
  }

  const supabase = adminClient()
  const myGroups = await leaderGroupIds(auth.userId)

  const scope = await memberInScope(userId, myGroups)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

  // Deleting only the profiles row used to leave the auth.users record behind —
  // the member could still log in, land on a profile-less app, and their rows in
  // every other table pointed at an id with no name. Clear the dependents first
  // (several carry FK constraints), then the profile, then the auth user.
  const cleanup: { table: string; column: string }[] = [
    { table: 'task_completions', column: 'user_id' },
    { table: 'habit_completions', column: 'user_id' },
    { table: 'habit_history', column: 'user_id' },
    { table: 'journal_responses', column: 'user_id' },
    { table: 'event_rsvps', column: 'user_id' },
    { table: 'room_bookings', column: 'user_id' },
    { table: 'push_subscriptions', column: 'user_id' },
    { table: 'nudge_preferences', column: 'user_id' },
    { table: 'messages', column: 'user_id' },
  ]

  const failedCleanup: string[] = []
  for (const { table, column } of cleanup) {
    const { error } = await supabase.from(table).delete().eq(column, userId)
    if (error) failedCleanup.push(`${table}: ${error.message}`)
  }

  // DMs are pairwise, so every conversation involving the member goes, along
  // with all its messages (both sides — a one-sided conversation is unreadable
  // and its rows would block the conversation delete via FK anyway).
  const { data: convos } = await supabase
    .from('dm_conversations')
    .select('id')
    .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
  const convoIds = (convos || []).map(c => c.id)
  if (convoIds.length) {
    const { error: dmError } = await supabase
      .from('direct_messages').delete().in('conversation_id', convoIds)
    if (dmError) failedCleanup.push(`direct_messages: ${dmError.message}`)
    const { error: convoError } = await supabase
      .from('dm_conversations').delete().in('id', convoIds)
    if (convoError) failedCleanup.push(`dm_conversations: ${convoError.message}`)
  }

  const { error } = await supabase.from('profiles').delete().eq('id', userId)
  if (error) {
    return NextResponse.json(
      { error: 'Delete failed', detail: error.message, cleanup_errors: failedCleanup },
      { status: 500 }
    )
  }

  // Without this the email stays registered, so the member cannot be re-invited
  // and can still authenticate. Reported rather than swallowed: a surviving auth
  // user is exactly the kind of half-done delete this codebase keeps hiding.
  const { error: authError } = await supabase.auth.admin.deleteUser(userId)

  return NextResponse.json({
    success: true,
    auth_user_deleted: !authError,
    ...(authError ? { auth_error: authError.message } : {}),
    ...(failedCleanup.length ? { cleanup_errors: failedCleanup } : {}),
  })
}

/**
 * A leader may only act on a member already in one of their groups, or on a
 * member with no group at all. Anything else belongs to another table.
 */
async function memberInScope(
  userId: string,
  myGroups: string[]
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: target, error } = await adminClient()
    .from('profiles')
    .select('id, group_id')
    .eq('id', userId)
    .maybeSingle()

  if (error) return { ok: false, status: 500, error: 'Could not load member' }
  if (!target) return { ok: false, status: 404, error: 'Member not found' }
  if (target.group_id && !myGroups.includes(target.group_id)) {
    return { ok: false, status: 403, error: 'That member belongs to another table' }
  }
  return { ok: true }
}
