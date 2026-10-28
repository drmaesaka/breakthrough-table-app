import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// The caller's own profile row plus their main table's name (2026-10-28).
// The fallback for lib/me.ts when the browser's own read of profiles comes
// back empty — on 2026-10-28 it did for everyone at once, and every screen
// that gates on role or group_id (Home tiles, the Admin tab) went blank.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = adminClient()
  const { data: prof, error } = await admin.from('profiles').select('*').eq('id', auth.userId).maybeSingle()
  if (error || !prof) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  const { data: g } = prof.group_id
    ? await admin.from('groups').select('name, last_period_start').eq('id', prof.group_id).maybeSingle()
    : { data: null }
  return NextResponse.json({ profile: { ...prof, groups: g || null } })
}
