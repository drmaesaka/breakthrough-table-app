import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader } from '@/lib/api-auth'

// Removing a TC Room resource. The browser tries first; if the database
// refuses quietly (a policy filters the delete to zero rows) the TC Room
// falls back to this route rather than showing the item as gone when it is
// not (a TC reported exactly that, 2026-10-07). Any TC may remove any TC
// Room resource, the same rule the TC Room has always had.
export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { data, error } = await adminClient().from('leader_resources').delete().eq('id', id).select('id')
  if (error) return NextResponse.json({ error: 'Could not remove', detail: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
