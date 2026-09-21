import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership } from '@/lib/api-auth'

// Roll call: one table, one day. The TC picks the date (defaults to today),
// optionally which playbook meeting it was, taps the names who were there,
// saves. PUT replaces the whole set for that table and day, so un-ticking
// someone marked by mistake works without a separate delete. Service key
// throughout — meeting_attendance has no write policies, on purpose.
//
// Keyed by date rather than meeting number since 2026-09-21 so roll call
// keeps working after the 12-meeting playbook is done.

const DATE = /^\d{4}-\d{2}-\d{2}$/

function migrationMissing(message: string) {
  return /meeting_date/.test(message) && /column|schema cache/.test(message)
}
const NEEDS_MIGRATION = 'Attendance by date needs the 2026-09-21 migration to be run in Supabase first'

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const groupId = req.nextUrl.searchParams.get('group_id') || ''
  const date = req.nextUrl.searchParams.get('date') || ''
  if (!groupId) return NextResponse.json({ error: 'group_id is required' }, { status: 400 })
  const own = await requireGroupOwnership(auth.userId, groupId)
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

  const supabase = adminClient()

  // One day's roll call.
  if (date) {
    if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    const { data, error } = await supabase
      .from('meeting_attendance').select('user_id, meeting_number')
      .eq('group_id', groupId).eq('meeting_date', date)
    if (error) {
      return NextResponse.json({ error: migrationMissing(error.message) ? NEEDS_MIGRATION : 'Could not load attendance' },
        { status: migrationMissing(error.message) ? 409 : 500 })
    }
    return NextResponse.json({
      user_ids: (data || []).map(r => r.user_id),
      meeting_number: data && data.length ? data[0].meeting_number : null,
    })
  }

  // History: every day this table took roll, newest first.
  const { data, error } = await supabase
    .from('meeting_attendance').select('meeting_date, meeting_number, user_id')
    .eq('group_id', groupId).order('meeting_date', { ascending: false }).limit(2000)
  if (error) {
    return NextResponse.json({ error: migrationMissing(error.message) ? NEEDS_MIGRATION : 'Could not load attendance' },
      { status: migrationMissing(error.message) ? 409 : 500 })
  }
  const days = new Map<string, { date: string; meeting_number: number | null; count: number }>()
  for (const r of data || []) {
    const d = days.get(r.meeting_date) || { date: r.meeting_date, meeting_number: r.meeting_number, count: 0 }
    d.count++
    days.set(r.meeting_date, d)
  }
  return NextResponse.json({ days: [...days.values()] })
}

export async function PUT(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id, date, number, user_ids } = await req.json().catch(() => ({}))
  if (!group_id || !DATE.test(String(date || '')) || !Array.isArray(user_ids)) {
    return NextResponse.json({ error: 'group_id, date and user_ids are required' }, { status: 400 })
  }
  const meetingNumber = number === null || number === undefined || number === '' ? null : Number(number)
  if (meetingNumber !== null && !Number.isInteger(meetingNumber)) {
    return NextResponse.json({ error: 'number must be a whole number or blank' }, { status: 400 })
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
    .eq('group_id', group_id).eq('meeting_date', date)
  if (clearError) {
    return NextResponse.json({ error: migrationMissing(clearError.message) ? NEEDS_MIGRATION : 'Could not save attendance' },
      { status: migrationMissing(clearError.message) ? 409 : 500 })
  }
  if (ids.length) {
    const { error } = await supabase.from('meeting_attendance').insert(
      ids.map(user_id => ({ group_id, meeting_date: date, meeting_number: meetingNumber, user_id, marked_by: auth.userId }))
    )
    if (error) return NextResponse.json({ error: 'Could not save attendance', detail: error.message }, { status: 500 })
  }

  // Taking roll for playbook meeting N moves the table to meeting N if it
  // was behind, so the members' journey headline keeps up without a separate
  // "mark as current" tap.
  let currentMoved: number | null = null
  if (meetingNumber !== null) {
    const { data: g } = await supabase.from('groups').select('current_meeting_number').eq('id', group_id).maybeSingle()
    if ((g?.current_meeting_number ?? -1) < meetingNumber) {
      const { error } = await supabase.from('groups').update({ current_meeting_number: meetingNumber }).eq('id', group_id)
      if (!error) currentMoved = meetingNumber
    }
  }
  return NextResponse.json({ user_ids: ids, current_meeting_number: currentMoved })
}
