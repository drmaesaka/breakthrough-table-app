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

  const supabase = adminClient()

  let { data: row, error: rowError } = await supabase
    .from(table)
    .select('id, group_id')
    .eq('id', id)
    .maybeSingle()

  // events has no group_id column until the 2026-07-29 migration runs; treat
  // those rows like the legacy null-group case rather than failing the edit.
  if (rowError && /group_id/.test(rowError.message)) {
    const retry = await supabase.from(table).select('id').eq('id', id).maybeSingle()
    row = retry.data ? { ...retry.data, group_id: null } : null
    rowError = retry.error
  }

  if (rowError) return NextResponse.json({ error: 'Could not load item' }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  // Rows carry the group they belong to; the caller must lead that group.
  // A null group_id only exists on events created before the group_id
  // migration — those are visible to everyone, so any leader may fix them.
  if (row.group_id) {
    const myGroups = await leaderGroupIds(auth.userId)
    if (!myGroups.includes(row.group_id)) {
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
