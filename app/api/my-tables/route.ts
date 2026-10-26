import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'
import { extraTablesOf } from '@/lib/memberships'

// The tables the caller belongs to: their main table first, then any extra
// tables (2026-10-26). For members' table switcher; TCs also have
// /api/admin/my-groups for the tables they lead.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = adminClient()
  const [{ data: prof }, extra] = await Promise.all([
    admin.from('profiles').select('group_id').eq('id', auth.userId).maybeSingle(),
    extraTablesOf(auth.userId),
  ])
  const ids = [...new Set([...(prof?.group_id ? [prof.group_id as string] : []), ...extra])]
  if (!ids.length) return NextResponse.json({ tables: [] })
  const { data: groups } = await admin.from('groups').select('id, name').in('id', ids)
  const name = new Map((groups || []).map(g => [g.id, g.name]))
  return NextResponse.json({
    tables: ids.filter(id => name.has(id)).map(id => ({ id, name: name.get(id), home: id === prof?.group_id })),
  })
}
