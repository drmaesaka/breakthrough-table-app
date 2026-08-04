'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import { localDay } from '@/lib/dates'
import {
  DEFAULT_SETTINGS,
  addDays,
  durationOptions,
  formatDuration,
  formatTime,
  hoursForDate,
  maxDurationAt,
  nowMinutes,
  parseTime,
  slotsForDate,
  toIntervals,
  toTimeString,
  type Interval,
  type VenueHours,
  type VenueSettings,
} from '@/lib/venue'

// The room schedule. As of 2026-08-03 this app is the venue's system of record
// for the physical suites — Skedda has been retired — so what this page shows is
// the real availability, not a second opinion.
//
// Nothing about the grid is hardcoded any more. Opening hours come from
// venue_hours and the rules from venue_settings, both editable in Admin → Rooms,
// because the venue's hours changing should not require a deploy.

export default function BookingPage() {
  const [rooms, setRooms] = useState<any[]>([])
  const [hours, setHours] = useState<VenueHours[]>([])
  const [settings, setSettings] = useState<VenueSettings>(DEFAULT_SETTINGS)
  const [selectedDate, setSelectedDate] = useState(localDay())
  const [bookings, setBookings] = useState<any[]>([])
  const [myBookings, setMyBookings] = useState<any[]>([])
  const [selectedRoom, setSelectedRoom] = useState<any>(null)
  const [selectedStart, setSelectedStart] = useState<number | null>(null)
  const [duration, setDuration] = useState<number>(0)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(false)
  const [userId, setUserId] = useState('')
  const [bookingSuccess, setBookingSuccess] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [noGroup, setNoGroup] = useState(false)
  const router = useRouter()

  const today = localDay()

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await createClient().auth.getSession()
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    }
  }

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const [{ data: prof }, { data: roomsData }, { data: hoursData }, { data: settingsData }] =
        await Promise.all([
          supabase.from('profiles').select('group_id').eq('id', user.id).maybeSingle(),
          supabase.from('rooms').select('*').order('sort_order').order('suite').order('name'),
          supabase.from('venue_hours').select('*').order('day_of_week'),
          supabase.from('venue_settings').select('*').eq('id', 1).maybeSingle(),
        ])

      // Signup is open and confirmation is off, so an account with no table is
      // possibly a stranger — rooms are a real-world resource, so booking is
      // members-only.
      if (!prof?.group_id) { setNoGroup(true); setLoading(false); return }

      // A room without a group_id is shared across tables; a stamped room only
      // shows for its own table. Archived rooms keep their booking history but
      // leave the grid.
      setRooms((roomsData || []).filter((r: any) =>
        r.is_active !== false && (!r.group_id || r.group_id === prof.group_id)
      ))
      setHours((hoursData || []) as VenueHours[])
      if (settingsData) setSettings(settingsData as VenueSettings)

      await loadAvailability(selectedDate)
      await loadMyBookings(user.id)
      setLoading(false)
    }
    load()
  }, [router])

  async function loadAvailability(date: string) {
    const supabase = createClient()
    const { data } = await supabase
      .from('room_bookings')
      .select('room_id, start_time, end_time, user_id, profiles(full_name)')
      .eq('booking_date', date)
    setBookings(data || [])
  }

  async function loadMyBookings(uid: string) {
    const supabase = createClient()
    const { data } = await supabase
      .from('room_bookings')
      .select('*, rooms(name, suite)')
      .eq('user_id', uid)
      .gte('booking_date', today)
      .order('booking_date', { ascending: true })
      .order('start_time', { ascending: true })
    setMyBookings(data || [])
  }

  async function handleDateChange(date: string) {
    setSelectedDate(date)
    setSelectedRoom(null)
    setSelectedStart(null)
    setBookingError('')
    await loadAvailability(date)
  }

  function takenFor(roomId: string): Interval[] {
    return toIntervals(bookings.filter((b: any) => b.room_id === roomId))
  }

  // The length is passed in rather than read from state: the button resolves it
  // at render time, and a setDuration() immediately before the call would not
  // have applied yet.
  async function book(minutes: number) {
    if (!selectedRoom || selectedStart === null || !minutes) return
    setBooking(true)

    // Every rule is re-checked server-side against the same lib/venue.ts this
    // page uses, and the database has the final word on overlap.
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        room_id: selectedRoom.id,
        booking_date: selectedDate,
        start_time: toTimeString(selectedStart),
        duration_minutes: minutes,
        notes: notes.trim() || null,
      }),
    })

    setBooking(false)

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      // A slot taken between page load and submit is the likeliest cause, so
      // refresh availability rather than leaving a stale grid on screen.
      setBookingError(error || "Couldn't book that room. Please try again.")
      await loadAvailability(selectedDate)
      return
    }

    setBookingError('')
    setBookingSuccess(true)
    setSelectedRoom(null)
    setSelectedStart(null)
    setNotes('')
    await loadAvailability(selectedDate)
    await loadMyBookings(userId)
    setTimeout(() => setBookingSuccess(false), 3000)
  }

  async function cancelBooking(id: string) {
    if (!confirm('Cancel this booking?')) return
    const res = await fetch('/api/bookings', {
      method: 'DELETE',
      headers: await authHeaders(),
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      setBookingError(error || "Couldn't cancel that booking — it's still reserved.")
      return
    }
    setMyBookings(b => b.filter(x => x.id !== id))
    if (myBookings.find(b => b.id === id)?.booking_date === selectedDate) {
      await loadAvailability(selectedDate)
    }
  }

  function formatDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  // Suites are derived from the rooms themselves. Hardcoding them meant that
  // adding a suite in the database left its rooms invisible on this page.
  const suites = Array.from(new Set(rooms.map(r => r.suite).filter(Boolean)))

  const daySlots = slotsForDate(hours, settings, selectedDate)
  const dayHours = hoursForDate(hours, selectedDate)
  const isClosed = !dayHours || dayHours.is_closed
  const nowMins = selectedDate === today ? nowMinutes() : null

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  if (noGroup) return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Book a Room</h1>
      </div>
      <div className="text-center py-20 px-8">
        <p className="text-5xl mb-4">🪑</p>
        <p className="text-gray-600 font-medium">Room booking is for table members</p>
        <p className="text-gray-400 text-sm mt-2 leading-relaxed">
          You&apos;re not part of a table yet. Join with the invite link from your
          leader, and rooms will open up here.
        </p>
      </div>
      <BottomNav />
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Book a Room</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">Reserve a space at Breakthrough Table</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-5">

        {bookingSuccess && (
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 text-center">
            <p className="text-green-700 font-semibold">✓ Room booked!</p>
          </div>
        )}

        {bookingError && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 text-center">
            <p className="text-red-700 font-semibold text-sm">{bookingError}</p>
          </div>
        )}

        {/* Date picker */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-bt-navy mb-3">Select a Date</h3>
          <input
            type="date"
            value={selectedDate}
            min={today}
            max={addDays(today, settings.booking_horizon_days)}
            onChange={e => handleDateChange(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
          />
          {!isClosed && dayHours && (
            <p className="text-xs text-gray-400 mt-2">
              Open {formatTime(parseTime(dayHours.open_time))} – {formatTime(parseTime(dayHours.close_time))}
            </p>
          )}
        </div>

        {/* My upcoming bookings */}
        {myBookings.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-bt-navy mb-3">Your Upcoming Bookings</h3>
            <div className="space-y-2">
              {myBookings.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between bg-bt-pale rounded-xl px-4 py-3">
                  <div>
                    <p className="font-semibold text-sm text-gray-900">{b.rooms?.name} <span className="text-gray-400 font-normal">· {b.rooms?.suite}</span></p>
                    <p className="text-xs text-gray-400">
                      {formatDate(b.booking_date)} · {formatTime(parseTime(b.start_time))} – {formatTime(parseTime(b.end_time))}
                    </p>
                    {b.notes && <p className="text-xs text-gray-400 mt-0.5">{b.notes}</p>}
                  </div>
                  <button onClick={() => cancelBooking(b.id)} className="text-xs text-red-400 font-medium ml-3 flex-shrink-0">Cancel</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isClosed && (
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
            <p className="text-4xl mb-3">🌙</p>
            <p className="text-gray-600 font-medium">The venue is closed that day</p>
            <p className="text-gray-400 text-sm mt-1">Pick another date to see open rooms.</p>
          </div>
        )}

        {!isClosed && rooms.length === 0 && (
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
            <p className="text-4xl mb-3">🪑</p>
            <p className="text-gray-600 font-medium">No rooms yet</p>
            <p className="text-gray-400 text-sm mt-1">Your leader can add them in the admin area.</p>
          </div>
        )}

        {/* Room availability by suite */}
        {!isClosed && suites.map(suite => {
          const suiteRooms = rooms.filter(r => r.suite === suite)
          if (suiteRooms.length === 0) return null
          return (
            <div key={suite}>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">{suite}</p>
              <div className="space-y-2">
                {suiteRooms.map(room => {
                  const taken = takenFor(room.id)
                  const isSelected = selectedRoom?.id === room.id

                  // A slot is bookable only if the shortest allowed booking fits
                  // in it, which is not the same as "nothing starts here" once
                  // bookings can run long.
                  const openStarts = daySlots.filter(s =>
                    (nowMins === null || s >= nowMins) &&
                    maxDurationAt(s, taken, hours, settings, selectedDate) > 0
                  )
                  const available = openStarts.length > 0

                  return (
                    <div key={room.id} className="bg-white rounded-2xl shadow-sm overflow-hidden transition-all">
                      <button
                        onClick={() => {
                          setSelectedRoom(isSelected ? null : room)
                          setSelectedStart(null)
                          setBookingError('')
                        }}
                        className="w-full px-5 py-4 flex items-center gap-4 text-left">
                        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${available ? 'bg-green-400' : 'bg-red-400'}`} />
                        <div className="flex-1">
                          <p className="font-bold text-gray-900">{room.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {room.room_type === 'private_office' ? 'Private Office' : 'Conference Room'}
                            {room.capacity ? ` · Up to ${room.capacity}` : ''}
                            {' · '}
                            <span className={available ? 'text-green-600' : 'text-red-400'}>
                              {available ? `${openStarts.length} slot${openStarts.length !== 1 ? 's' : ''} open` : 'Fully booked'}
                            </span>
                          </p>
                        </div>
                        <svg className={`w-4 h-4 text-gray-300 transition-transform ${isSelected ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isSelected && (
                        <div className="px-5 pb-5 border-t border-gray-50 pt-4 space-y-4">
                          <div>
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Pick a start time</p>
                            <div className="grid grid-cols-3 gap-2">
                              {daySlots.map(slot => {
                                const longest = maxDurationAt(slot, taken, hours, settings, selectedDate)
                                const past = nowMins !== null && slot < nowMins
                                const disabled = past || longest === 0
                                const isPicked = selectedStart === slot
                                return (
                                  <button key={slot} disabled={disabled}
                                    onClick={() => {
                                      setSelectedStart(slot)
                                      // Keep the current choice when it still
                                      // fits, so changing your mind about the
                                      // time does not silently reset the length.
                                      setDuration(d => (d && d <= longest ? d : Math.min(settings.min_duration_minutes, longest)))
                                    }}
                                    className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                                      disabled ? 'bg-gray-100 text-gray-300 cursor-not-allowed line-through' :
                                      isPicked ? 'bg-bt-navy text-white' :
                                      'bg-bt-pale text-bt-navy'
                                    }`}>
                                    {formatTime(slot)}
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {selectedStart !== null && (() => {
                            const longest = maxDurationAt(selectedStart, taken, hours, settings, selectedDate)
                            const options = durationOptions(settings).filter(d => d <= longest)
                            const chosen = duration && duration <= longest ? duration : options[0]
                            return (
                              <div className="space-y-4">
                                <div>
                                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">How long</p>
                                  <div className="grid grid-cols-4 gap-2">
                                    {options.map(d => (
                                      <button key={d} onClick={() => setDuration(d)}
                                        className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                                          chosen === d ? 'bg-bt-navy text-white' : 'bg-bt-pale text-bt-navy'
                                        }`}>
                                        {formatDuration(d)}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <input
                                  value={notes}
                                  onChange={e => setNotes(e.target.value)}
                                  placeholder="Notes (optional)"
                                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue"
                                />
                                <button
                                  onClick={() => book(chosen)}
                                  disabled={booking || !chosen}
                                  className="w-full bg-bt-navy text-white py-3.5 rounded-xl font-semibold text-sm disabled:opacity-50">
                                  {booking
                                    ? 'Booking...'
                                    : `Book ${room.name} · ${formatTime(selectedStart)} – ${formatTime(selectedStart + chosen)}`}
                                </button>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <BottomNav />
    </div>
  )
}
