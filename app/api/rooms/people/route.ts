import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// Everyone in BT, for the "who's in this group" picker. Name, photo and the
// table they sit at — nothing else. Not limited to the directory opt-in:
// a group chat is started by someone who already knows the person.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = adminClient()
  // The table name is looked up by group_id directly rather than through a
  // groups(name) embed: the picker showed seated people as "No table"
  // (reported 2026-10-09), and a plain lookup leaves nothing to resolve.
  const [{ data, error }, { data: groups }] = await Promise.all([
    admin.from('profiles').select('id, full_name, avatar_url, group_id')
      .neq('id', auth.userId).order('full_name', { ascending: true }),
    admin.from('groups').select('id, name'),
  ])
  if (error) return NextResponse.json({ error: 'Could not load people' }, { status: 500 })
  const nameOf = new Map<string, string>((groups || []).map(g => [g.id, g.name]))
  return NextResponse.json({
    people: (data || []).map(p => ({
      id: p.id, full_name: p.full_name || 'Unnamed', avatar_url: p.avatar_url || null,
      table: p.group_id ? nameOf.get(p.group_id) || 'A table' : null,
    })),
  })
}
