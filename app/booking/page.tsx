'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

const TIME_SLOTS = [
  '08:00','09:00','10:00','11:00','12:00',
  '13:00','14:00','15:00','16:00','17:00','18:00','19:00',
]

function formatSlot(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`
}

function endSlot(t: string) {
  const [h] = t.split(':').map(Number)
  const end = h + 1
  return `${end % 12 || 12}:00 ${end >= 12 ? 'PM' : 'AM'}`
}

export default function BookingPage() {
  const [rooms, setRooms] = useState<any[]>([])
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [bookings, setBookings] = useState<any[]>([])
  const [myBookings, setMyBookings] = useState<any[]>([])
  const [selectedRoom, setSelectedRoom] = useState<any>(null)
  const [selectedTime, setSelectedTime] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(false)
  const [userId, setUserId] = useState('')
  const [bookingSuccess, setBookingSuccess] = useState(false)
  const router = useRouter()

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const { data: roomsData } = await supabase.from('rooms').select('*').order('suite').order('name')
      setRooms(roomsData || [])

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
      .select('room_id, start_time, user_id, profiles(full_name)')
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
    setMyBookings(data || [])
  }

  async function handleDateChange(date: string) {
    setSelectedDate(date)
    setSelectedRoom(null)
    setSelectedTime('')
    await loadAvailability(date)
  }

  async function book() {
    if (!selectedRoom || !selectedDate || !selectedTime) return
    setBooking(true)
    const supabase = createClient()
    const { error } = await supabase.from('room_bookings').insert({
      room_id: selectedRoom.id,
      user_id: userId,
      booking_date: selectedDate,
      start_time: selectedTime,
      end_time: `${String(parseInt(selectedTime) + 1).padStart(2,'0')}:00`,
      notes: notes.trim() || null,
    })

    if (!error) {
      setBookingSuccess(true)
      setSelectedRoom(null)
      setSelectedTime('')
      setNotes('')
      await loadAvailability(selectedDate)
      await loadMyBookings(userId)
      setTimeout(() => setBookingSuccess(false), 3000)
    }
    setBooking(false)
  }

  async function cancelBooking(id: string) {
    if (!confirm('Cancel this booking?')) return
    const supabase = createClient()
    await supabase.from('room_bookings').delete().eq('id', id).eq('user_id', userId)
    setMyBookings(b => b.filter(x => x.id !== id))
  }

  function getBookedSlotsForRoom(roomId: string) {
    return new Set(bookings.filter((b: any) => b.room_id === roomId).map((b: any) => b.start_time))
  }

  function isRoomAvailable(roomId: string) {
    const booked = getBookedSlotsForRoom(roomId)
    return TIME_SLOTS.some(s => !booked.has(s))
  }

  function formatDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const suites = ['Suite 1', 'Suite 2']

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
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

        {/* Date picker */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-bt-navy mb-3">Select a Date</h3>
          <input
            type="date"
            value={selectedDate}
            min={today}
            onChange={e => handleDateChange(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
          />
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
                    <p className="text-xs text-gray-400">{formatDate(b.booking_date)} · {formatSlot(b.start_time)} – {endSlot(b.start_time)}</p>
                    {b.notes && <p className="text-xs text-gray-400 mt-0.5">{b.notes}</p>}
                  </div>
                  <button onClick={() => cancelBooking(b.id)} className="text-xs text-red-400 font-medium ml-3 flex-shrink-0">Cancel</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Room availability by suite */}
        {suites.map(suite => {
          const suiteRooms = rooms.filter(r => r.suite === suite)
          if (suiteRooms.length === 0) return null
          return (
            <div key={suite}>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">{suite}</p>
              <div className="space-y-2">
                {suiteRooms.map(room => {
                  const available = isRoomAvailable(room.id)
                  const isSelected = selectedRoom?.id === room.id
                  const bookedSlots = getBookedSlotsForRoom(room.id)
                  const availableCount = TIME_SLOTS.filter(s => !bookedSlots.has(s)).length

                  return (
                    <div key={room.id} className={`bg-white rounded-2xl shadow-sm overflow-hidden transition-all`}>
                      <button
                        onClick={() => {
                          setSelectedRoom(isSelected ? null : room)
                          setSelectedTime('')
                        }}
                        className="w-full px-5 py-4 flex items-center gap-4 text-left">
                        {/* Availability dot */}
                        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${available ? 'bg-green-400' : 'bg-red-400'}`} />
                        <div className="flex-1">
                          <p className="font-bold text-gray-900">{room.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {room.room_type === 'private_office' ? 'Private Office' : 'Conference Room'}
                            {room.capacity ? ` · Up to ${room.capacity}` : ''}
                            {' · '}
                            <span className={available ? 'text-green-600' : 'text-red-400'}>
                              {available ? `${availableCount} slot${availableCount !== 1 ? 's' : ''} open` : 'Fully booked'}
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
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Pick a time slot</p>
                            <div className="grid grid-cols-3 gap-2">
                              {TIME_SLOTS.map(slot => {
                                const isBooked = bookedSlots.has(slot)
                                const isPicked = selectedTime === slot
                                return (
                                  <button key={slot} disabled={isBooked}
                                    onClick={() => setSelectedTime(slot)}
                                    className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                                      isBooked ? 'bg-gray-100 text-gray-300 cursor-not-allowed line-through' :
                                      isPicked ? 'bg-bt-navy text-white' :
                                      'bg-bt-pale text-bt-navy'
                                    }`}>
                                    {isBooked ? formatSlot(slot) : formatSlot(slot)}
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {selectedTime && (
                            <div className="space-y-3">
                              <input
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="Notes (optional)"
                                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue"
                              />
                              <button onClick={book} disabled={booking}
                                className="w-full bg-bt-navy text-white py-3.5 rounded-xl font-semibold text-sm disabled:opacity-50">
                                {booking ? 'Booking...' : `Book ${room.name} · ${formatSlot(selectedTime)} – ${endSlot(selectedTime)}`}
                              </button>
                            </div>
                          )}
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
