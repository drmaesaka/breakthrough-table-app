import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// The table the caller sits at: id, name and when its period started.
// Server-side (2026-10-10) because the browser's groups(name) embed came
// back empty for a new member — Home lost "Your table", Library its
// "current period" — the groups read hinges on a console-only policy.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = adminClient()
  const { data: prof } = await admin.from('profiles').select('group_id').eq('id', auth.userId).maybeSingle()
  if (!prof?.group_id) return NextResponse.json({ table: null })
  const { data: g } = await admin.from('groups').select('id, name, last_period_start').eq('id', prof.group_id).maybeSingle()
  return NextResponse.json({ table: g || null })
}
