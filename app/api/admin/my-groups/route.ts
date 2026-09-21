import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'

// The tables the caller leads, as full group rows, via the service key.
//
// The browser used to work this out itself (lib/leader-groups.ts), reading
// `groups` under RLS. The groups read policy lives only in the Supabase
// console and is not guaranteed to admit a co-leader who does not also SIT
// at the table — such a leader saw no tables at all in Admin, and every
// form answered "No group selected". Ownership is resolved here exactly as
// every admin route resolves it (primary or co-leader), so what the leader
// sees in the picker is what the API will let them act on.

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const ids = await leaderGroupIds(auth.userId)
  if (!ids.length) return NextResponse.json({ groups: [] })

  const { data, error } = await adminClient()
    .from('groups')
    .select('*')
    .in('id', ids)
    .order('name', { ascending: true })
  if (error) return NextResponse.json({ error: 'Could not load your tables' }, { status: 500 })
  return NextResponse.json({ groups: data || [] })
}
