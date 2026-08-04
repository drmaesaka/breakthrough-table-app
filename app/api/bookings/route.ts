import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'
import {
  DEFAULT_SETTINGS,
  formatTime,
  parseTime,
  toIntervals,
  toTimeString,
  validateBooking,
  type VenueHours,
  type VenueSettings,
} from '@/lib/venue'
import { bookingConfirmationEmail, bookingCancellationEmail, sendEmail } from '@/lib/send-email'

// Member room booking.
//
// This used to be a direct client-side insert into room_bookings. That was fine
// while every booking was a fixed hour and the only rule was "not already
// taken", which a unique index could enforce on its own. It is not fine now:
// opening hours, duration bounds, the booking horizon and per-member limits all
// live in venue_hours / venue_settings, and a browser that can read those tables
// can also ignore them.
//
// So the rules run here, against the same lib/venue.ts the UI uses, and the
// final word on overlap belongs to the exclusion constraint in the database —
// two members submitting the same slot a millisecond apart both pass any check
// written in application code.

/** Postgres exclusion_violation — the overlap constraint rejecting the insert. */
const EXCLUSION_VIOLATION = '23P01'

async function loadVenue(): Promise<{ hours: VenueHours[]; settings: VenueSettings }> {
  const supabase = adminClient()
  const [{ data: hours }, { data: settings }] = await Promise.all([
    supabase.from('venue_hours').select('*').order('day_of_week'),
    supabase.from('venue_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  return {
    hours: (hours || []) as VenueHours[],
    settings: (settings || DEFAULT_SETTINGS) as VenueSettings,
  }
}

/** Local calendar day, never toISOString — see lib/dates.ts for why. */
function today(): string {
  return new Date().toLocaleDateString('en-CA')
}

function dateLabel(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * The address to notify.
 *
 * The auth address wins: it is the account the member signs in with and the one
 * password resets already go to. profiles.contact_email is a directory field
 * members fill in for networking, so it may be a shared or work address nobody
 * reads — a fallback, not a preference.
 */
async function emailFor(userId: string, contactEmail: string | null): Promise<string | null> {
  const { data } = await adminClient().auth.admin.getUserById(userId)
  return data?.user?.email || contactEmail || null
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const { room_id, booking_date, start_time } = body
  const duration = Number(body.duration_minutes)

  if (!room_id || !booking_date || !start_time || !Number.isInteger(duration)) {
    return NextResponse.json(
      { error: 'room_id, booking_date, start_time and duration_minutes are required' },
      { status: 400 }
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) {
    return NextResponse.json({ error: 'booking_date must look like 2026-08-05' }, { status: 400 })
  }

  const supabase = adminClient()

  // Rooms are a real-world resource, so booking stays members-only — an account
  // with no table may be a stranger, since signup is open and unconfirmed.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, group_id, contact_email')
    .eq('id', auth.userId)
    .maybeSingle()

  if (!profile?.group_id) {
    return NextResponse.json({ error: 'Room booking is for table members' }, { status: 403 })
  }

  const { data: room } = await supabase
    .from('rooms')
    .select('id, name, suite, group_id, is_active')
    .eq('id', room_id)
    .maybeSingle()

  if (!room || room.is_active === false) {
    return NextResponse.json({ error: 'That room is not available' }, { status: 404 })
  }
  // A room stamped with a group_id belongs to one table; an unstamped room is shared.
  if (room.group_id && room.group_id !== profile.group_id) {
    return NextResponse.json({ error: 'That room belongs to another table' }, { status: 403 })
  }

  const { hours, settings } = await loadVenue()
  const start = parseTime(start_time)
  const end = start + duration

  const { data: sameDay, error: sameDayError } = await supabase
    .from('room_bookings')
    .select('start_time, end_time')
    .eq('room_id', room_id)
    .eq('booking_date', booking_date)

  if (sameDayError) {
    return NextResponse.json(
      { error: 'Could not check availability', detail: sameDayError.message },
      { status: 500 }
    )
  }

  const problem = validateBooking({
    start,
    duration,
    taken: toIntervals(sameDay || []),
    hours,
    settings,
    dateStr: booking_date,
    today: today(),
    nowMinutes: new Date().getHours() * 60 + new Date().getMinutes(),
  })
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  // ---- Per-member limits -------------------------------------------------
  if (settings.max_active_bookings_per_member) {
    const { count } = await supabase
      .from('room_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .gte('booking_date', today())
    if ((count || 0) >= settings.max_active_bookings_per_member) {
      return NextResponse.json(
        {
          error: `You can hold ${settings.max_active_bookings_per_member} upcoming booking${
            settings.max_active_bookings_per_member === 1 ? '' : 's'
          } at a time. Cancel one to book another.`,
        },
        { status: 409 }
      )
    }
  }

  if (settings.max_minutes_per_member_per_day) {
    const { data: mine } = await supabase
      .from('room_bookings')
      .select('start_time, end_time')
      .eq('user_id', auth.userId)
      .eq('booking_date', booking_date)
    const already = (mine || []).reduce(
      (sum, b) => sum + (parseTime(b.end_time) - parseTime(b.start_time)),
      0
    )
    if (already + duration > settings.max_minutes_per_member_per_day) {
      const hoursCap = settings.max_minutes_per_member_per_day / 60
      return NextResponse.json(
        { error: `That would put you over the ${hoursCap}-hour daily limit for one member.` },
        { status: 409 }
      )
    }
  }

  // ---- Write -------------------------------------------------------------
  // user_id comes from the verified token, never from the body.
  const { data: booking, error } = await supabase
    .from('room_bookings')
    .insert({
      room_id,
      user_id: auth.userId,
      booking_date,
      start_time: toTimeString(start),
      end_time: toTimeString(end),
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    })
    .select('*, rooms(name, suite)')
    .single()

  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      return NextResponse.json(
        { error: 'Someone just booked part of that time. Pick another slot.' },
        { status: 409 }
      )
    }
    console.error('room booking failed:', error.message, error.code)
    return NextResponse.json({ error: 'Could not book that room', detail: error.message }, { status: 500 })
  }

  // Dormant until Resend is verified — see lib/send-email.ts. Never allowed to
  // fail the booking: the room is already held, and telling the member it did
  // not work would be worse than a missing email.
  const to = await emailFor(auth.userId, profile.contact_email)
  if (to) {
    const details = {
      memberName: profile.full_name || 'there',
      roomName: room.name,
      suite: room.suite,
      dateLabel: dateLabel(booking_date),
      timeLabel: `${formatTime(start)} – ${formatTime(end)}`,
      notes: booking.notes,
    }
    const msg = bookingConfirmationEmail(details)
    await sendEmail({ to, ...msg }).catch(err =>
      console.error('booking confirmation email threw:', err?.message)
    )
  }

  return NextResponse.json({ booking })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const supabase = adminClient()
  const { data: booking } = await supabase
    .from('room_bookings')
    .select('*, rooms(name, suite)')
    .eq('id', id)
    .maybeSingle()

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  // Leaders cancel other members' bookings through /api/admin/bookings, which
  // checks that the member is in one of their tables. This route is own-bookings
  // only, so the check is a plain identity match.
  if (booking.user_id !== auth.userId) {
    return NextResponse.json({ error: 'That is not your booking' }, { status: 403 })
  }

  const { error } = await supabase.from('room_bookings').delete().eq('id', id)
  if (error) {
    console.error('booking cancel failed:', error.message)
    return NextResponse.json({ error: 'Could not cancel that booking', detail: error.message }, { status: 500 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, contact_email')
    .eq('id', auth.userId)
    .maybeSingle()

  const to = await emailFor(auth.userId, profile?.contact_email ?? null)
  if (to) {
    const msg = bookingCancellationEmail({
      memberName: profile?.full_name || 'there',
      roomName: booking.rooms?.name || 'Room',
      suite: booking.rooms?.suite || '',
      dateLabel: dateLabel(booking.booking_date),
      timeLabel: `${formatTime(parseTime(booking.start_time))} – ${formatTime(parseTime(booking.end_time))}`,
    })
    await sendEmail({ to, ...msg }).catch(err =>
      console.error('booking cancellation email threw:', err?.message)
    )
  }

  return NextResponse.json({ success: true })
}
