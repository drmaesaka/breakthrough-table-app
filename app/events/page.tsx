'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import type { SunriseEvent } from '@/lib/sunrise-events'

/** Same event already posted in the app (same day, overlapping name)? Then the app's copy, with its RSVP, wins. */
function alsoInApp(s: SunriseEvent, events: any[]) {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  const day = (d: string) => new Date(d).toDateString()
  const name = norm(s.title)
  return events.some(e => day(e.event_date) === day(s.start) && (norm(e.title).includes(name) || name.includes(norm(e.title))))
}

export default function EventsPage() {
  const [events, setEvents] = useState<any[]>([])
  const [rsvps, setRsvps] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const [rsvping, setRsvping] = useState<string | null>(null)
  const [rsvpError, setRsvpError] = useState<string | null>(null)
  // Sunrise Network's own events (2026-10-09), straight from Sunrise; tickets
  // are bought there. Loaded after the app's so a slow Sunrise never holds
  // the page up. See lib/sunrise-events.ts.
  const [sunrise, setSunrise] = useState<SunriseEvent[]>([])
  const [openSunrise, setOpenSunrise] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      // Served by /api/events: BT-wide events plus this member's table's.
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/events', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
      const json = res.ok ? await res.json() : { events: [], rsvp_event_ids: [] }
      setEvents(json.events || [])
      setRsvps(new Set<string>(json.rsvp_event_ids || []))
      setLoading(false)
      const sr = await fetch('/api/events/sunrise', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } }).catch(() => null)
      if (sr?.ok) setSunrise((await sr.json()).events || [])
    }
    load()
  }, [router])

  async function toggleRsvp(eventId: string) {
    setRsvping(eventId)
    const supabase = createClient()
    const hasRsvp = rsvps.has(eventId)

    // Only move the RSVP locally once the write lands — showing "I'm going" for
    // a rejected insert leaves the member registered in their head only, and the
    // leader's headcount short by one.
    if (hasRsvp) {
      const { error } = await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', userId)
      if (error) console.error('rsvp delete failed:', error.message)
      else setRsvps(r => { const s = new Set(r); s.delete(eventId); return s })
      setRsvpError(error ? eventId : null)
    } else {
      const { error } = await supabase.from('event_rsvps').insert({ event_id: eventId, user_id: userId })
      if (error) console.error('rsvp insert failed:', error.message)
      else setRsvps(r => new Set([...r, eventId]))
      setRsvpError(error ? eventId : null)
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
    // Compare calendar days, not elapsed hours. Dividing a millisecond gap by
    // 24h and rounding up made an event later tonight read as "Tomorrow", and
    // made the 'Today' branch unreachable outside an exact millisecond match.
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diff = Math.round((startOfDay(new Date(d)) - startOfDay(new Date())) / 86400000)
    if (diff <= 0) return 'Today'
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
        {events.length === 0 && sunrise.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📅</p>
            <p className="text-gray-500 font-medium">No upcoming events</p>
            <p className="text-gray-400 text-sm mt-1">Check back soon</p>
          </div>
        )}

        {[
          ...events.map(e => ({ at: e.event_date as string, app: e, sun: null as SunriseEvent | null })),
          ...sunrise.filter(s => !alsoInApp(s, events)).map(s => ({ at: s.start, app: null as any, sun: s })),
        ].sort((a, b) => a.at.localeCompare(b.at)).map(({ app: event, sun }) => {
          if (sun) {
            const until = daysUntil(sun.start)
            const open = openSunrise === sun.id
            return (
              <div key={sun.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="h-1.5 bg-amber-400" />
                {sun.image && <img src={sun.image} alt="" className="w-full max-h-44 object-cover" />}
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">🌅 Sunrise Network</span>
                    <span className={`text-xs font-semibold ${until === 'Today' ? 'text-orange-500' : 'text-gray-400'}`}>{until}</span>
                  </div>
                  <h3 className="font-bold text-gray-900 text-base leading-tight">{sun.title}</h3>
                  {sun.tagline && <p className="text-gray-500 text-sm mt-0.5">{sun.tagline}</p>}
                  <p className="text-gray-400 text-xs mt-1">{formatDate(sun.start)} · {formatTime(sun.start)}{sun.end ? ` – ${formatTime(sun.end)}` : ''}</p>
                  {sun.location && <p className="text-gray-500 text-sm mt-1">📍 {sun.location}</p>}
                  {sun.description && (
                    <button type="button" onClick={() => setOpenSunrise(open ? null : sun.id)} className="block text-left mt-2">
                      <p className={`text-gray-500 text-sm leading-relaxed whitespace-pre-line ${open ? '' : 'line-clamp-3'}`}>{sun.description}</p>
                      <span className="text-bt-blue text-xs font-semibold">{open ? 'Less' : 'More'}</span>
                    </button>
                  )}
                  {sun.url && (
                    <a href={sun.url} target="_blank" rel="noopener noreferrer"
                      className="block mt-4 py-2.5 rounded-xl font-semibold text-sm bg-bt-navy text-white text-center">
                      Details &amp; tickets →
                    </a>
                  )}
                </div>
              </div>
            )
          }
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
                      {event.group_id && (
                        <span className="text-xs font-semibold text-gray-400">· Your table</span>
                      )}
                    </div>
                    <h3 className="font-bold text-gray-900 text-base leading-tight">{event.title}</h3>
                    <p className="text-gray-400 text-xs mt-1">{formatDate(event.event_date)} · {formatTime(event.event_date)}{event.end_date ? ` – ${formatTime(event.end_date)}` : ''}</p>
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
                  {rsvpError === event.id && (
                    <span className="text-red-600 text-xs">Didn&apos;t save — try again</span>
                  )}
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
