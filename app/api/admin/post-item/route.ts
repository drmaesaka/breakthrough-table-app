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
  // Reading posted from My Table carries no period label: use the table's
  // current one, as Admin does.
  if (table === 'tasks') {
    for (const r of clean) {
      if (r.period_label) continue
      const { data: last } = await adminClient().from('tasks').select('period_label')
        .eq('group_id', r.group_id as string).order('created_at', { ascending: false }).limit(1).maybeSingle()
      r.period_label = last?.period_label || 'Current'
    }
  }

  const { data, error } = await adminClient().from(table).insert(clean).select()
  if (error) return NextResponse.json({ error: 'Could not save', detail: error.message }, { status: 500 })
  return NextResponse.json({ items: data })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // count: true → only report the copies (no delete). all: true → remove every copy.
  const { table, id, count, all } = await req.json().catch(() => ({}))
  if (!TABLES[table as string] || !id) return NextResponse.json({ error: 'table and id are required' }, { status: 400 })

  const supabase = adminClient()
  const { data: row } = await supabase.from(table).select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const mine = await leaderGroupIds(auth.userId)
  if (row.group_id && !mine.includes(row.group_id)) {
    return NextResponse.json({ error: 'That item belongs to another table' }, { status: 403 })
  }

  // Posting to several tables at once writes one row per table. Removing it in
  // Admin removed only the open table's copy, so it "came back" — it was still
  // on the others (TC report 2026-10-07). Copies = same title (and link, for
  // the library) posted within a few minutes, at a table this TC leads.
  let ids: string[] = [id]
  if ((count || all) && table !== 'journal_prompts' && row.group_id) {
    const t = new Date(row.created_at).getTime()
    let q = supabase.from(table).select('id, group_id').in('group_id', mine).eq('title', row.title)
      .gte('created_at', new Date(t - 5 * 60000).toISOString()).lte('created_at', new Date(t + 5 * 60000).toISOString())
    if (table === 'content') q = q.eq('url', row.url)
    const { data: copies } = await q
    const copyIds = (copies || []).map((c: any) => c.id as string)
    if (count) {
      const { data: names } = await supabase.from('groups').select('name').in('id', (copies || []).map((c: any) => c.group_id))
      return NextResponse.json({ copies: copyIds.length, tables: (names || []).map((g: any) => g.name) })
    }
    if (copyIds.length) ids = copyIds
  }

  if (table === 'tasks') {
    const { error } = await supabase.from('task_completions').delete().in('task_id', ids)
    if (error) return NextResponse.json({ error: 'Could not remove', detail: error.message }, { status: 500 })
  }
  if (table === 'journal_prompts') {
    const { error } = await supabase.from('journal_responses').delete().eq('prompt_id', id)
    if (error) return NextResponse.json({ error: 'Could not remove', detail: error.message }, { status: 500 })
  }
  const { data: gone, error } = await supabase.from(table).delete().in('id', ids).select('id')
  if (error) return NextResponse.json({ error: 'Could not remove', detail: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, removed: (gone || []).length })
}
