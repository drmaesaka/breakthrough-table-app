import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// Everyone in BT, for the "who's in this group" picker. Name, photo and the
// table they sit at — nothing else. Not limited to the directory opt-in:
// a group chat is started by someone who already knows the person.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { data, error } = await adminClient()
    .from('profiles')
    .select('id, full_name, avatar_url, groups(name)')
    .neq('id', auth.userId)
    .order('full_name', { ascending: true })
  if (error) return NextResponse.json({ error: 'Could not load people' }, { status: 500 })
  return NextResponse.json({
    people: (data || []).map((p: any) => ({
      id: p.id, full_name: p.full_name || 'Unnamed', avatar_url: p.avatar_url || null,
      table: (Array.isArray(p.groups) ? p.groups[0] : p.groups)?.name || null,
    })),
  })
}
