'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function EventsPage() {
  const [events, setEvents] = useState<any[]>([])
  const [rsvps, setRsvps] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const [rsvping, setRsvping] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const [{ data: eventsData }, { data: rsvpData }] = await Promise.all([
        supabase.from('events')
          .select('*, profiles(full_name)')
          .gte('event_date', new Date().toISOString())
          .order('event_date', { ascending: true }),
        supabase.from('event_rsvps').select('event_id').eq('user_id', user.id),
      ])

      setEvents(eventsData || [])
      setRsvps(new Set((rsvpData || []).map((r: any) => r.event_id)))
      setLoading(false)
    }
    load()
  }, [router])

  async function toggleRsvp(eventId: string) {
    setRsvping(eventId)
    const supabase = createClient()
    const hasRsvp = rsvps.has(eventId)

    if (hasRsvp) {
      await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', userId)
      setRsvps(r => { const s = new Set(r); s.delete(eventId); return s })
    } else {
      await supabase.from('event_rsvps').insert({ event_id: eventId, user_id: userId })
      setRsvps(r => new Set([...r, eventId]))
    }
    setRsvping(null)
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
  }
  function formatTime(d: string) {
    return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  function daysUntil(d: string) {
    const diff = Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    return `In ${diff} days`
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Events</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">Breakthrough Table — upcoming events</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">
        {events.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📅</p>
            <p className="text-gray-500 font-medium">No upcoming events</p>
            <p className="text-gray-400 text-sm mt-1">Check back soon</p>
          </div>
        )}

        {events.map(event => {
          const isRsvped = rsvps.has(event.id)
          const isVirtual = event.event_type === 'virtual'
          const until = daysUntil(event.event_date)
          const isToday = until === 'Today'

          return (
            <div key={event.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {/* Color band */}
              <div className={`h-1.5 ${isVirtual ? 'bg-bt-blue' : 'bg-green-500'}`} />
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        isVirtual ? 'bg-bt-pale text-bt-blue' : 'bg-green-50 text-green-700'
                      }`}>
                        {isVirtual ? '💻 Virtual' : '📍 In Person'}
                      </span>
                      <span className={`text-xs font-semibold ${isToday ? 'text-orange-500' : 'text-gray-400'}`}>
                        {until}
                      </span>
                    </div>
                    <h3 className="font-bold text-gray-900 text-base leading-tight">{event.title}</h3>
                    <p className="text-gray-400 text-xs mt-1">{formatDate(event.event_date)} · {formatTime(event.event_date)}</p>
                    {event.location && !isVirtual && (
                      <p className="text-gray-500 text-sm mt-1">📍 {event.location}</p>
                    )}
                    {event.description && (
                      <p className="text-gray-500 text-sm mt-2 leading-relaxed">{event.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-4">
                  <button
                    onClick={() => toggleRsvp(event.id)}
                    disabled={rsvping === event.id}
                    className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${
                      isRsvped
                        ? 'bg-bt-navy text-white'
                        : 'bg-bt-pale text-bt-navy border border-bt-navy/20'
                    }`}>
                    {rsvping === event.id ? '...' : isRsvped ? '✓ I\'m going' : 'RSVP'}
                  </button>
                  {isVirtual && event.virtual_link && isRsvped && (
                    <a href={event.virtual_link} target="_blank" rel="noopener noreferrer"
                      className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-bt-blue text-white text-center">
                      Join Link →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <BottomNav />
    </div>
  )
}
