import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = adminClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, group_id, role, adherence_percent, streak')
    .order('full_name', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })

  // A member with no push subscription silently receives nothing — the leader
  // has no other way to tell them apart from a member who is simply never due.
  const { data: subs } = await supabase.from('push_subscriptions').select('user_id')
  const subscribed = new Set((subs || []).map((s: any) => s.user_id))

  const members = (data || []).map(m => ({ ...m, push_enabled: subscribed.has(m.id) }))
  return NextResponse.json({ members })
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

  const updates: Record<string, unknown> = {}
  if (groupId !== undefined) updates.group_id = groupId || null
  if (role !== undefined) updates.role = role
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await adminClient().from('profiles').update(updates).eq('id', userId)
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

  const { error } = await adminClient().from('profiles').delete().eq('id', userId)
  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  return NextResponse.json({ success: true })
}
