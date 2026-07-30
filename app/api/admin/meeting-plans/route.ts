import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership } from '@/lib/api-auth'
import { MEETING_PLANS } from '@/lib/meeting-plans'

// Meeting plans are group-wide content, so every write here uses the service
// key: meeting_plans carries a SELECT policy and nothing else, and a browser
// UPDATE filtered away by RLS returns 200 having changed nothing.
//
// A plan with group_id NULL is the BT-wide default. A plan with a group_id is
// one table's override of that meeting number. Editing a default from inside a
// table copies it to an override first (copy-on-write), so one TC reworking
// their own meeting 4 cannot rewrite meeting 4 for every other table.

const SECTIONS = ['resources', 'foundations', 'curriculum', 'challenges'] as const

/** Bullets arrive as a textarea split by line, so drop blanks and stray spaces. */
function cleanBullets(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean)
}

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const groupId = new URL(req.url).searchParams.get('group_id')
  const supabase = adminClient()

  const { data: defaults, error: defaultsError } = await supabase
    .from('meeting_plans')
    .select('*')
    .is('group_id', null)
    .order('number', { ascending: true })

  if (defaultsError) {
    return NextResponse.json(
      { error: 'Could not load meeting plans', detail: defaultsError.message },
      { status: 500 }
    )
  }

  let overrides: unknown[] = []
  if (groupId) {
    const owns = await requireGroupOwnership(auth.userId, groupId)
    if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

    const { data, error } = await supabase
      .from('meeting_plans')
      .select('*')
      .eq('group_id', groupId)
      .order('number', { ascending: true })
    if (error) {
      return NextResponse.json(
        { error: 'Could not load table overrides', detail: error.message },
        { status: 500 }
      )
    }
    overrides = data || []
  }

  return NextResponse.json({ defaults: defaults || [], overrides })
}

/**
 * Seeds the BT-wide defaults from lib/meeting-plans.ts. Idempotent — existing
 * rows are left alone, so a TC's edits survive a re-seed. The curriculum stays
 * in the repo as the starting point rather than being transcribed into SQL,
 * where 395 lines of bullets would be retyped by hand exactly once and wrongly.
 */
export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = adminClient()
  const { data: existing, error: existingError } = await supabase
    .from('meeting_plans')
    .select('number')
    .is('group_id', null)

  if (existingError) {
    return NextResponse.json(
      { error: 'Could not check existing plans', detail: existingError.message },
      { status: 500 }
    )
  }

  const have = new Set((existing || []).map(r => r.number))
  const missing = MEETING_PLANS.filter(m => !have.has(m.number)).map(m => ({
    group_id: null,
    number: m.number,
    title: m.title,
    resources: m.resources,
    foundations: m.foundations,
    curriculum: m.curriculum,
    challenges: m.challenges,
    updated_by: auth.userId,
  }))

  if (missing.length === 0) return NextResponse.json({ seeded: 0 })

  const { error } = await supabase.from('meeting_plans').insert(missing)
  if (error) {
    return NextResponse.json({ error: 'Seed failed', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ seeded: missing.length })
}

export async function PUT(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const { group_id: rawGroupId, number, title } = body
  const groupId: string | null = rawGroupId || null

  if (typeof number !== 'number' || !Number.isInteger(number) || number < 0) {
    return NextResponse.json({ error: 'A whole meeting number is required' }, { status: 400 })
  }
  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  if (groupId) {
    const owns = await requireGroupOwnership(auth.userId, groupId)
    if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })
  }

  const row = {
    group_id: groupId,
    number,
    title: title.trim(),
    ...Object.fromEntries(SECTIONS.map(s => [s, cleanBullets(body[s])])),
    updated_at: new Date().toISOString(),
    updated_by: auth.userId,
  }

  const supabase = adminClient()

  // Two partial unique indexes back this table, and PostgREST's upsert cannot
  // target a partial index, so resolve the existing row first and branch.
  const existingQuery = supabase.from('meeting_plans').select('id').eq('number', number)
  const { data: existing, error: existingError } = await (
    groupId ? existingQuery.eq('group_id', groupId) : existingQuery.is('group_id', null)
  ).maybeSingle()

  if (existingError) {
    return NextResponse.json(
      { error: 'Could not load the plan', detail: existingError.message },
      { status: 500 }
    )
  }

  const { data: saved, error } = existing
    ? await supabase.from('meeting_plans').update(row).eq('id', existing.id).select().single()
    : await supabase.from('meeting_plans').insert(row).select().single()

  if (error) {
    return NextResponse.json({ error: 'Save failed', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ plan: saved })
}

/**
 * Sets which meeting a table is currently on, so /meetings opens on it.
 * Server-side because it writes a row in `groups`, which members cannot update
 * and a leader's browser write would be filtered away without erroring.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id: groupId, current_meeting_number: number } = await req.json().catch(() => ({}))
  if (!groupId) return NextResponse.json({ error: 'group_id is required' }, { status: 400 })
  if (number !== null && !Number.isInteger(number)) {
    return NextResponse.json(
      { error: 'current_meeting_number must be a whole number or null' },
      { status: 400 }
    )
  }

  const owns = await requireGroupOwnership(auth.userId, groupId)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  const { error } = await adminClient()
    .from('groups')
    .update({ current_meeting_number: number })
    .eq('id', groupId)

  if (error) {
    return NextResponse.json({ error: 'Update failed', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ current_meeting_number: number })
}

/** Drops a table's override so that meeting falls back to the BT default. */
export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const groupId = url.searchParams.get('group_id')
  const number = Number(url.searchParams.get('number'))

  // Guarding this is the difference between "reset my table's meeting 4" and
  // "delete meeting 4 for all of BT" — the second has no undo.
  if (!groupId) {
    return NextResponse.json(
      { error: 'group_id is required — the BT default cannot be deleted here' },
      { status: 400 }
    )
  }
  if (!Number.isInteger(number)) {
    return NextResponse.json({ error: 'A whole meeting number is required' }, { status: 400 })
  }

  const owns = await requireGroupOwnership(auth.userId, groupId)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  const { error } = await adminClient()
    .from('meeting_plans')
    .delete()
    .eq('group_id', groupId)
    .eq('number', number)

  if (error) {
    return NextResponse.json({ error: 'Reset failed', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ reset: true })
}
