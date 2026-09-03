import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership } from '@/lib/api-auth'

// Roll call for one meeting of one table. The TC taps the names who were
// there and saves; PUT replaces the whole set for that meeting, so un-ticking
// someone marked by mistake works without a separate delete. Service key
// throughout — meeting_attendance has no write policies, on purpose.

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const groupId = req.nextUrl.searchParams.get('group_id') || ''
  const number = Number(req.nextUrl.searchParams.get('number'))
  if (!groupId || !Number.isInteger(number)) {
    return NextResponse.json({ error: 'group_id and number are required' }, { status: 400 })
  }
  const own = await requireGroupOwnership(auth.userId, groupId)
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

  const { data, error } = await adminClient()
    .from('meeting_attendance')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('meeting_number', number)
  if (error) {
    // Before the 2026-09-03 migration the table does not exist. Say so.
    const missing = /meeting_attendance/.test(error.message) && /not exist|schema cache/.test(error.message)
    return NextResponse.json(
      { error: missing ? 'Attendance needs the 2026-09-03 migration to be run in Supabase first' : 'Could not load attendance' },
      { status: missing ? 409 : 500 }
    )
  }
  return NextResponse.json({ user_ids: (data || []).map(r => r.user_id) })
}

export async function PUT(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id, number, user_ids } = await req.json().catch(() => ({}))
  if (!group_id || !Number.isInteger(number) || !Array.isArray(user_ids)) {
    return NextResponse.json({ error: 'group_id, number and user_ids are required' }, { status: 400 })
  }
  const own = await requireGroupOwnership(auth.userId, group_id)
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

  const supabase = adminClient()

  // Only people who actually sit at this table can be marked present at it.
  const { data: seated } = await supabase.from('profiles').select('id').eq('group_id', group_id)
  const allowed = new Set((seated || []).map(p => p.id))
  const ids: string[] = [...new Set(user_ids.filter((id: unknown): id is string => typeof id === 'string' && allowed.has(id)))]

  const { error: clearError } = await supabase
    .from('meeting_attendance').delete()
    .eq('group_id', group_id).eq('meeting_number', number)
  if (clearError) {
    const missing = /meeting_attendance/.test(clearError.message) && /not exist|schema cache/.test(clearError.message)
    return NextResponse.json(
      { error: missing ? 'Attendance needs the 2026-09-03 migration to be run in Supabase first' : 'Could not save attendance' },
      { status: missing ? 409 : 500 }
    )
  }
  if (ids.length) {
    const { error } = await supabase.from('meeting_attendance').insert(
      ids.map(user_id => ({ group_id, meeting_number: number, user_id, marked_by: auth.userId }))
    )
    if (error) return NextResponse.json({ error: 'Could not save attendance', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ user_ids: ids })
}
