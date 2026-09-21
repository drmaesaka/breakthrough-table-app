import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'

// Creating and deleting the things a leader posts to a table: reading &
// resources (tasks), library items (content), reflection prompts.
//
// Server-side with the service key because the INSERT policies on these
// tables live only in the Supabase console and recognise a table's original
// TC (groups.leader_id) — a co-leader got "new row violates row-level
// security policy" (2026-09-21, Table 14). Deletes had the worse failure: an
// RLS-filtered delete returns 200 having removed nothing. Ownership here is
// the union the rest of the app uses: primary or co-leader.

const TABLES: Record<string, string[]> = {
  tasks: ['group_id', 'title', 'description', 'period_label'],
  content: ['group_id', 'title', 'url', 'type', 'description'],
  journal_prompts: ['group_id', 'prompt', 'posted_by'],
}

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { table, rows } = await req.json().catch(() => ({}))
  const allowed = TABLES[table as string]
  if (!allowed || !Array.isArray(rows) || rows.length === 0 || rows.length > 50) {
    return NextResponse.json({ error: 'table and rows are required' }, { status: 400 })
  }

  const mine = await leaderGroupIds(auth.userId)
  const clean = rows.map((r: any) => {
    const out: Record<string, unknown> = {}
    for (const k of allowed) if (k in r) out[k] = r[k]
    return out
  })
  for (const r of clean) {
    if (typeof r.group_id !== 'string' || !mine.includes(r.group_id)) {
      return NextResponse.json({ error: 'You can only post to tables you lead' }, { status: 403 })
    }
  }
  // Attribution comes from the token, never the body.
  if (table === 'journal_prompts') for (const r of clean) r.posted_by = auth.userId

  const { data, error } = await adminClient().from(table).insert(clean).select()
  if (error) return NextResponse.json({ error: 'Could not save', detail: error.message }, { status: 500 })
  return NextResponse.json({ items: data })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { table, id } = await req.json().catch(() => ({}))
  if (!TABLES[table as string] || !id) return NextResponse.json({ error: 'table and id are required' }, { status: 400 })

  const supabase = adminClient()
  const { data: row } = await supabase.from(table).select('id, group_id').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const mine = await leaderGroupIds(auth.userId)
  if (row.group_id && !mine.includes(row.group_id)) {
    return NextResponse.json({ error: 'That item belongs to another table' }, { status: 403 })
  }

  if (table === 'tasks') {
    const { error } = await supabase.from('task_completions').delete().eq('task_id', id)
    if (error) return NextResponse.json({ error: 'Could not remove', detail: error.message }, { status: 500 })
  }
  if (table === 'journal_prompts') {
    const { error } = await supabase.from('journal_responses').delete().eq('prompt_id', id)
    if (error) return NextResponse.json({ error: 'Could not remove', detail: error.message }, { status: 500 })
  }
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not remove', detail: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
