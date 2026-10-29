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

// Saves the caller's own name, photo and directory details (2026-10-29).
// The browser's own update of profiles went through with no error but changed
// nothing, so a new name or photo was gone on the next visit. Only the fields
// below can be changed here; role and table stay with the admin routes.
const EDITABLE = ['full_name', 'avatar_url', 'directory_opt_in', 'bio', 'linkedin_url', 'contact_email', 'onboarded'] as const

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await req.json().catch(() => ({}))
  const changes: Record<string, unknown> = {}
  for (const k of EDITABLE) if (k in body) changes[k] = body[k]
  if (typeof changes.full_name === 'string') {
    changes.full_name = changes.full_name.trim()
    if (!changes.full_name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }
  if (!Object.keys(changes).length) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
  const { data, error } = await adminClient().from('profiles').update(changes).eq('id', auth.userId).select().maybeSingle()
  if (error || !data) return NextResponse.json({ error: error?.message || 'Profile not found' }, { status: 500 })
  return NextResponse.json({ profile: data })
}
