import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'
import { isFree, parseTime, toIntervals } from '@/lib/venue'

// Booking on behalf of a member and cancelling a member's booking both write
// another user's rows, which the browser client cannot do: room_bookings RLS is
// scoped to the caller. The old client-side versions were filtered to zero rows
// while the UI reported success — same failure mode as Start New Period.

async function memberInMyGroups(leaderId: string, userId: string) {
  const myGroups = await leaderGroupIds(leaderId)
  const { data: target } = await adminClient()
    .from('profiles')
    .select('id, group_id')
    .eq('id', userId)
    .maybeSingle()
  if (!target) return { ok: false as const, status: 404, error: 'Member not found' }
  if (target.group_id && !myGroups.includes(target.group_id)) {
    return { ok: false as const, status: 403, error: 'That member belongs to another table' }
  }
  return { ok: true as const }
}

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { room_id, user_id, booking_date, start_time, end_time } = await req.json().catch(() => ({}))
  if (!room_id || !user_id || !booking_date || !start_time || !end_time) {
    return NextResponse.json({ error: 'room_id, user_id, booking_date, start_time and end_time are required' }, { status: 400 })
  }

  const scope = await memberInMyGroups(auth.userId, user_id)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const supabase = adminClient()

  // The member booking page refuses a taken slot; without the same check here a
  // leader would double-book it with the service key.
  //
  // Matching on start_time alone was enough while every booking was a fixed
  // hour. Once lengths vary, 09:00-11:00 and 10:00-10:30 have different start
  // times and still collide, so the whole day has to be compared as intervals.
  const { data: sameDay } = await supabase
    .from('room_bookings')
    .select('start_time, end_time')
    .eq('room_id', room_id)
    .eq('booking_date', booking_date)

  const start = parseTime(start_time)
  const end = parseTime(end_time)
  if (end <= start) {
    return NextResponse.json({ error: 'The booking has to end after it starts' }, { status: 400 })
  }
  if (!isFree(start, end, toIntervals(sameDay || []))) {
    return NextResponse.json({ error: 'That overlaps a booking already on the calendar' }, { status: 409 })
  }

  const { data, error } = await supabase
    .from('room_bookings')
    .insert({ room_id, user_id, booking_date, start_time, end_time })
    .select('*, rooms(name, suite), profiles(full_name)')
    .single()

  if (error) {
    // 23P01 is the exclusion constraint added 2026-08-03. The check above races
    // with any concurrent write, so the database gets the final word.
    if (error.code === '23P01') {
      return NextResponse.json({ error: 'Someone just booked part of that time' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Booking failed', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ booking: data })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const supabase = adminClient()
  const { data: booking } = await supabase
    .from('room_bookings')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle()
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const scope = await memberInMyGroups(auth.userId, booking.user_id)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const { error } = await supabase.from('room_bookings').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Cancel failed', detail: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
