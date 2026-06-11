'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

const TIME_SLOTS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00',
  '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
]

function formatSlot(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2,'0')} ${ampm}`
}

function endTime(t: string) {
  const [h] = t.split(':').map(Number)
  const end = h + 1
  const ampm = end >= 12 ? 'PM' : 'AM'
  const hour = end % 12 || 12
  return `${hour}:00 ${ampm}`
}

export default function BookingPage() {
  const [rooms, setRooms] = useState<any[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [myBookings, setMyBookings] = useState<any[]>([])
  const [selectedRoom, setSelectedRoom] = useState<any>(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(false)
  const [userId, setUserId] = useState('')
  const router = useRouter()

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const [{ data: roomsData }, { data: myBData }] = await Promise.all([
        supabase.from('rooms').select('*').order('name'),
        supabase.from('room_bookings')
          .select('*, rooms(name)')
          .eq('user_id', user.id)
          .gte('booking_date', today)
          .order('booking_date', { ascending: true }),
      ])

      setRooms(roomsData || [])
      setMyBookings(myBData || [])
      setLoading(false)
    }
    load()
  }, [router])

  async function loadAvailability(roomId: string, date: string) {
    if (!roomId || !date) return
    const supabase = createClient()
    const { data } = await supabase.from('room_bookings')
      .select('start_time, user_id, profiles(full_name)')
      .eq('room_id', roomId)
      .eq('booking_date', date)
    setBookings(data || [])
  }

  async function book() {
    if (!selectedRoom || !selectedDate || !selectedTime) return
    setBooking(true)
    const supabase = createClient()
    const endT = `${String(parseInt(selectedTime) + 1).padStart(2,'0')}:00`
    const { error } = await supabase.from('room_bookings').insert({
      room_id: selectedRoom.id,
      user_id: userId,
      booking_date: selectedDate,
      start_time: selectedTime,
      end_time: endT,
      notes: notes.trim() || null,
    })

    if (!error) {
      // Refresh
      const supabase2 = createClient()
      const [{ data: myBData }] = await Promise.all([
        supabase2.from('room_bookings')
          .select('*, rooms(name)')
          .eq('user_id', userId)
          .gte('booking_date', today)
          .order('booking_date', { ascending: true }),
      ])
      setMyBookings(myBData || [])
      await loadAvailability(selectedRoom.id, selectedDate)
      setSelectedTime('')
      setNotes('')
    }
    setBooking(false)
  }

  async function cancelBooking(bookingId: string) {
    if (!confirm('Cancel this booking?')) return
    const supabase = createClient()
    await supabase.from('room_bookings').delete().eq('id', bookingId).eq('user_id', userId)
    setMyBookings(b => b.filter(x => x.id !== bookingId))
  }

  const bookedSlots = new Set(bookings.map((b: any) => b.start_time))

  function formatDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Room Booking</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">Reserve a space at Breakthrough Table</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">

        {/* My upcoming bookings */}
        {myBookings.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-bt-navy mb-3">Your Upcoming Bookings</h3>
            <div className="space-y-2">
              {myBookings.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between bg-bt-pale rounded-xl px-4 py-3">
                  <div>
                    <p className="font-semibold text-sm text-gray-900">{b.rooms?.name}</p>
                    <p className="text-xs text-gray-400">{formatDate(b.booking_date)} · {formatSlot(b.start_time)} – {endTime(b.start_time)}</p>
                  </div>
                  <button onClick={() => cancelBooking(b.id)}
                    className="text-xs text-red-400 font-medium">Cancel</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Room selector */}
        {rooms.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">🏢</p>
            <p className="text-gray-500 font-medium">No rooms available yet</p>
            <p className="text-gray-400 text-sm mt-1">Check back soon</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <h3 className="font-bold text-bt-navy">Select a Room</h3>
              <div className="space-y-2">
                {rooms.map(room => (
                  <button key={room.id}
                    onClick={() => {
                      setSelectedRoom(room)
                      setSelectedTime('')
                      if (selectedDate) loadAvailability(room.id, selectedDate)
                    }}
                    className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                      selectedRoom?.id === room.id ? 'border-bt-navy bg-bt-pale' : 'border-gray-100'
                    }`}>
                    <p className="font-semibold text-sm text-gray-900">{room.name}</p>
                    {room.description && <p className="text-xs text-gray-400 mt-0.5">{room.description}</p>}
                    {room.capacity && <p className="text-xs text-gray-400 mt-0.5">Up to {room.capacity} people</p>}
                  </button>
                ))}
              </div>
            </div>

            {selectedRoom && (
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-bt-navy">Select a Date</h3>
                <input
                  type="date"
                  value={selectedDate}
                  min={today}
                  onChange={e => {
                    setSelectedDate(e.target.value)
                    setSelectedTime('')
                    if (selectedRoom) loadAvailability(selectedRoom.id, e.target.value)
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
                />
              </div>
            )}

            {selectedRoom && selectedDate && (
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-bt-navy">Select a Time</h3>
                <div className="grid grid-cols-3 gap-2">
                  {TIME_SLOTS.map(slot => {
                    const isBooked = bookedSlots.has(slot)
                    const isSelected = selectedTime === slot
                    return (
                      <button key={slot}
                        disabled={isBooked}
                        onClick={() => setSelectedTime(slot)}
                        className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                          isBooked ? 'bg-gray-100 text-gray-300 cursor-not-allowed' :
                          isSelected ? 'bg-bt-navy text-white' :
                          'bg-bt-pale text-bt-navy'
                        }`}>
                        {isBooked ? '✗' : formatSlot(slot)}
                      </button>
                    )
                  })}
                </div>
                {selectedTime && (
                  <div className="pt-2 space-y-3">
                    <input
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Notes (optional) — e.g. meeting with team"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue"
                    />
                    <button onClick={book} disabled={booking}
                      className="w-full bg-bt-navy text-white py-3.5 rounded-xl font-semibold disabled:opacity-50">
                      {booking ? 'Booking...' : `Book ${selectedRoom.name} · ${formatSlot(selectedTime)}`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
