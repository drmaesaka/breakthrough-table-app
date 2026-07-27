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
