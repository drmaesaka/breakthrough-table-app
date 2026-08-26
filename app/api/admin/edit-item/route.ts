import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'

// One route for every "leader fixes a typo" edit. Server-side on purpose: none
// of these tables are known to carry UPDATE policies for leaders, and an
// RLS-filtered UPDATE from the browser returns 200 having changed nothing —
// the exact silent failure that broke Start New Period. The service key makes
// the write real; the checks below make it legal.

const EDITABLE: Record<string, string[]> = {
  tasks: ['title', 'description'],
  content: ['title', 'url', 'type', 'description'],
  events: ['title', 'description', 'event_date', 'event_type', 'location', 'virtual_link',
           'notifications_enabled', 'followup_message'],
  journal_prompts: ['prompt'],
  // A table's name was fixed at creation, so a typo lived forever. Name only:
  // leader_id and last_period_start drive authorization and the period reset,
  // and neither belongs behind a rename box.
  groups: ['name'],
}

export async function PATCH(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { table, id, fields } = await req.json().catch(() => ({}))
  const allowed = EDITABLE[table as string]
  if (!allowed) return NextResponse.json({ error: 'Table not editable' }, { status: 400 })
  if (!id || !fields || typeof fields !== 'object') {
    return NextResponse.json({ error: 'id and fields are required' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in fields) updates[key] = fields[key]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields in request' }, { status: 400 })
  }

  // A blank name would leave members staring at an unnamed table and no way to
  // pick it out of the group selector. Trimmed here so " " cannot slip through.
  if (table === 'groups' && typeof updates.name === 'string') {
    const trimmed = updates.name.trim()
    if (!trimmed) return NextResponse.json({ error: 'A table needs a name' }, { status: 400 })
    updates.name = trimmed
  }

  const supabase = adminClient()

  // `groups` has no group_id column — a group IS the group. Asking for one
  // would land in the legacy-events branch below, which reads a missing column
  // as "no owner" and would let any leader rename any table. Two literal
  // queries rather than a computed column list, because supabase-js infers the
  // row type from the string and a computed one erases it.
  type OwnedRow = { id: string; group_id?: string | null }

  let row: OwnedRow | null = null
  let rowError: { message: string } | null = null

  if (table === 'groups') {
    const r = await supabase.from(table).select('id').eq('id', id).maybeSingle()
    row = r.data as OwnedRow | null
    rowError = r.error
  } else {
    const r = await supabase.from(table).select('id, group_id').eq('id', id).maybeSingle()
    row = r.data as OwnedRow | null
    rowError = r.error
  }

  // events has no group_id column until the 2026-07-29 migration runs; treat
  // those rows like the legacy null-group case rather than failing the edit.
  if (rowError && /group_id/.test(rowError.message)) {
    const retry = await supabase.from(table).select('id').eq('id', id).maybeSingle()
    row = retry.data ? { ...retry.data, group_id: null } : null
    rowError = retry.error
  }

  if (rowError) return NextResponse.json({ error: 'Could not load item' }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  // Rows carry the group they belong to; the caller must lead that group. For a
  // groups row that is its own id. A null owner only exists on events created
  // before the group_id migration — those are visible to everyone, so any
  // leader may fix them.
  const owningGroupId = table === 'groups' ? row.id : (row.group_id ?? null)

  if (owningGroupId) {
    const myGroups = await leaderGroupIds(auth.userId)
    if (!myGroups.includes(owningGroupId)) {
      return NextResponse.json({ error: 'That item belongs to another table' }, { status: 403 })
    }
  }

  const { data: updated, error } = await supabase
    .from(table)
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Update failed', detail: error.message }, { status: 500 })
  return NextResponse.json({ item: updated })
}
