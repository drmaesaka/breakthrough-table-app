import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}

type AuthResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; error: string }

/**
 * Resolves the caller from their bearer token and confirms the leader role.
 * Routes using the service-role client MUST call this — that client bypasses RLS,
 * so it is the only thing standing between the request and every row in the table.
 */
export async function requireLeader(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const token = authHeader.slice('Bearer '.length)
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, error: 'Unauthorized' }

  const { data: prof } = await adminClient()
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (prof?.role !== 'leader') return { ok: false, status: 403, error: 'Forbidden' }

  return { ok: true, userId: user.id, role: prof.role }
}

/**
 * Resolves the caller from their bearer token without requiring the leader role.
 *
 * For routes a member calls on their own behalf. Those routes still run with the
 * service key — not because the member lacks permission to write their own row,
 * but because the rules being enforced (opening hours, booking limits) live on
 * tables the member cannot see enough of to check.
 *
 * The returned userId is the ONLY safe source of identity: a user_id in the
 * request body is whatever the caller typed.
 */
export async function requireUser(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const token = authHeader.slice('Bearer '.length)
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, error: 'Unauthorized' }

  const { data: prof } = await adminClient()
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  return { ok: true, userId: user.id, role: prof?.role || 'member' }
}

/**
 * The group ids this leader owns. Being a leader is app-wide, not per-table, so
 * every service-key route that touches group data must narrow to these — without
 * it any leader can read and write every other table's members.
 */
export async function leaderGroupIds(userId: string): Promise<string[]> {
  const { data } = await adminClient()
    .from('groups')
    .select('id')
    .eq('leader_id', userId)
  return (data || []).map(g => g.id as string)
}

/** Confirms `groupId` is one of the caller's own groups. */
export async function requireGroupOwnership(
  userId: string,
  groupId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: group, error } = await adminClient()
    .from('groups')
    .select('id, leader_id')
    .eq('id', groupId)
    .maybeSingle()

  if (error) return { ok: false, status: 500, error: 'Could not load group' }
  if (!group) return { ok: false, status: 404, error: 'Group not found' }
  if (group.leader_id !== userId) {
    return { ok: false, status: 403, error: 'Not the leader of this group' }
  }
  return { ok: true }
}
