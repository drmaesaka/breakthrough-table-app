import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership, leaderGroupIds } from '@/lib/api-auth'

// Co-leaders for a table.
//
// `groups.leader_id` is a single uuid, so until 2026-08-03 a table had exactly
// one person who could act on it. A TC away for a week froze their whole table:
// no period rollover, no meeting outline edits, no broadcasts. This route
// manages the group_leaders join table that fixes that.
//
// Service key throughout: group_leaders has a SELECT policy and nothing else,
// and adding a leader also writes another member's profiles row, which the
// browser client cannot do — an RLS-filtered write returns 200 having changed
// nothing.
//
// Co-leaders have identical powers to the primary. `is_primary` is a label for
// display and attribution, not a permission level. The one thing it controls is
// which id stays in groups.leader_id, kept in sync here because RLS policies
// written in the Supabase console still read that column.

async function leadersOf(groupId: string) {
  const { data } = await adminClient()
    .from('group_leaders')
    .select('id, user_id, is_primary, added_at, profiles(full_name)')
    .eq('group_id', groupId)
    .order('is_primary', { ascending: false })
  return data || []
}

/**
 * Drops the app-wide leader role from someone who no longer leads any table.
 *
 * Without this a removed co-leader keeps `role = 'leader'` forever: they pass
 * requireLeader, reach the admin panel, and find it empty. Harmless but
 * confusing, and it quietly widens who counts as a leader over time.
 */
async function demoteIfLeadsNothing(userId: string) {
  const remaining = await leaderGroupIds(userId)
  if (remaining.length) return
  const { error } = await adminClient()
    .from('profiles')
    .update({ role: 'participant' })
    .eq('id', userId)
  if (error) console.error('could not demote former leader:', error.message)
}

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const groupId = new URL(req.url).searchParams.get('group_id')
  if (!groupId) return NextResponse.json({ error: 'group_id is required' }, { status: 400 })

  const owns = await requireGroupOwnership(auth.userId, groupId)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  return NextResponse.json({ leaders: await leadersOf(groupId) })
}

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id, user_id } = await req.json().catch(() => ({}))
  if (!group_id || !user_id) {
    return NextResponse.json({ error: 'group_id and user_id are required' }, { status: 400 })
  }

  const owns = await requireGroupOwnership(auth.userId, group_id)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  const supabase = adminClient()
  const { data: target } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', user_id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { error } = await supabase
    .from('group_leaders')
    .insert({ group_id, user_id, is_primary: false, added_by: auth.userId })

  if (error) {
    // 23505 — already a leader of this table. Idempotent rather than an error:
    // the caller wanted them leading, and they are.
    if (error.code !== '23505') {
      return NextResponse.json({ error: 'Could not add the co-leader', detail: error.message }, { status: 500 })
    }
  }

  // Leading a table is useless without the app-wide role — requireLeader gates
  // every admin route before group ownership is ever consulted.
  if (target.role !== 'leader') {
    const { error: roleError } = await supabase
      .from('profiles')
      .update({ role: 'leader' })
      .eq('id', user_id)
    if (roleError) {
      return NextResponse.json(
        { error: 'Added to the table, but could not grant the leader role', detail: roleError.message },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ leaders: await leadersOf(group_id) })
}

/** Makes someone the primary TC, demoting the current one to co-leader. */
export async function PATCH(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id, user_id } = await req.json().catch(() => ({}))
  if (!group_id || !user_id) {
    return NextResponse.json({ error: 'group_id and user_id are required' }, { status: 400 })
  }

  const owns = await requireGroupOwnership(auth.userId, group_id)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  const supabase = adminClient()
  const { data: row } = await supabase
    .from('group_leaders')
    .select('id')
    .eq('group_id', group_id)
    .eq('user_id', user_id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'That person does not lead this table' }, { status: 404 })

  // Clear the old primary first. group_leaders_one_primary is a unique index on
  // (group_id) where is_primary, so setting the new one first would collide.
  const { error: clearError } = await supabase
    .from('group_leaders')
    .update({ is_primary: false })
    .eq('group_id', group_id)
    .eq('is_primary', true)
  if (clearError) {
    return NextResponse.json({ error: 'Could not reassign', detail: clearError.message }, { status: 500 })
  }

  const { error: setError } = await supabase
    .from('group_leaders')
    .update({ is_primary: true })
    .eq('id', row.id)
  if (setError) {
    return NextResponse.json({ error: 'Could not reassign', detail: setError.message }, { status: 500 })
  }

  // Kept in sync because console-written RLS policies still read this column.
  const { error: groupError } = await supabase
    .from('groups')
    .update({ leader_id: user_id })
    .eq('id', group_id)
  if (groupError) {
    return NextResponse.json(
      { error: 'Primary changed, but the group record still names the old leader', detail: groupError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ leaders: await leadersOf(group_id) })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id, user_id } = await req.json().catch(() => ({}))
  if (!group_id || !user_id) {
    return NextResponse.json({ error: 'group_id and user_id are required' }, { status: 400 })
  }

  const owns = await requireGroupOwnership(auth.userId, group_id)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  const supabase = adminClient()
  const current = await leadersOf(group_id)

  // A table with no leader cannot be administered by anyone, and no screen in
  // the app would show that it had happened.
  if (current.length <= 1) {
    return NextResponse.json(
      { error: 'A table needs at least one leader. Add another before removing this one.' },
      { status: 409 }
    )
  }

  const target = current.find(l => l.user_id === user_id)
  if (!target) return NextResponse.json({ error: 'That person does not lead this table' }, { status: 404 })
  if (target.is_primary) {
    return NextResponse.json(
      { error: 'Make someone else the main TC first, then remove this one.' },
      { status: 409 }
    )
  }

  const { error } = await supabase
    .from('group_leaders')
    .delete()
    .eq('group_id', group_id)
    .eq('user_id', user_id)

  if (error) {
    return NextResponse.json({ error: 'Could not remove the co-leader', detail: error.message }, { status: 500 })
  }

  await demoteIfLeadsNothing(user_id)
  return NextResponse.json({ leaders: await leadersOf(group_id) })
}
