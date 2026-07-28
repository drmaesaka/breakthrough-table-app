import { NextRequest, NextResponse } from 'next/server'
import { requireLeader, adminClient } from '@/lib/api-auth'

// Rolling a period over touches every member's row, which the browser client
// cannot do: the profiles UPDATE policy is scoped to `id = auth.uid()`, so the
// group-wide resets this used to run client-side were silently filtered to the
// leader's own row and reported success. Runs with the service key instead,
// behind a leader check plus ownership of the specific group.
export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id } = await req.json().catch(() => ({}))
  if (!group_id) {
    return NextResponse.json({ error: 'group_id is required' }, { status: 400 })
  }

  const supabase = adminClient()

  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('id, leader_id')
    .eq('id', group_id)
    .maybeSingle()

  if (groupError) {
    return NextResponse.json({ error: 'Could not load group' }, { status: 500 })
  }
  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }
  if (group.leader_id !== auth.userId) {
    return NextResponse.json({ error: 'Not the leader of this group' }, { status: 403 })
  }

  // Whether the period being closed actually had tasks. With no tasks,
  // adherence reduces to "did you do your habit today", so everyone who did
  // sits at 100% and would be credited a period streak for completing nothing.
  const { count: closingTaskCount } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', group_id)
    .eq('archived', false)

  const periodHadTasks = (closingTaskCount ?? 0) > 0

  const { error: archiveError } = await supabase
    .from('tasks')
    .update({ archived: true })
    .eq('group_id', group_id)
    .eq('archived', false)

  if (archiveError) {
    return NextResponse.json(
      { error: 'Failed to archive tasks', detail: archiveError.message },
      { status: 500 }
    )
  }

  const { error: periodError } = await supabase
    .from('groups')
    .update({ last_period_start: new Date().toISOString() })
    .eq('id', group_id)

  if (periodError) {
    return NextResponse.json(
      { error: 'Failed to record period start', detail: periodError.message },
      { status: 500 }
    )
  }

  const { data: members, error: membersError } = await supabase
    .from('profiles')
    .select('id, full_name, streak, adherence_percent')
    .eq('group_id', group_id)

  if (membersError) {
    return NextResponse.json(
      { error: 'Failed to load members', detail: membersError.message },
      { status: 500 }
    )
  }

  // The period streak is credited here, once per rollover. It used to be
  // incremented inside the task/habit toggle handlers, which added +1 on every
  // toggle that left everything complete — unchecking and rechecking inflated
  // it without bound.
  const credited: string[] = []
  const reset: string[] = []
  const failed: string[] = []

  for (const m of members || []) {
    const finishedPeriod = periodHadTasks && (m.adherence_percent || 0) >= 100
    // An empty period leaves streaks alone entirely — crediting it would reward
    // doing nothing, and zeroing it would punish a period nobody could complete.
    const streakUpdate = periodHadTasks
      ? { streak: finishedPeriod ? (m.streak || 0) + 1 : 0 }
      : {}

    const { error } = await supabase
      .from('profiles')
      .update({ ...streakUpdate, adherence_percent: 0 })
      .eq('id', m.id)

    const name = m.full_name || m.id
    if (error) failed.push(name)
    else if (finishedPeriod) credited.push(name)
    else reset.push(name)
  }

  return NextResponse.json({
    members: (members || []).length,
    period_had_tasks: periodHadTasks,
    credited,
    reset,
    failed,
  })
}
