'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

// Alumni and monthly drop-in tables. Deliberately not filtered by group_id:
// an alumnus keeps their account but has no table, so anything scoped the way
// events are would be invisible to exactly the people this page is for.
//
// There is no payment step. Whether drop-ins pay, and through what, is still
// open — a "Pay" button here would imply an answer nobody has given yet.

type Session = {
  id: string
  kind: 'alumni' | 'dropin'
  title: string
  session_date: string
  end_date: string | null
  location: string | null
  description: string | null
  capacity: number | null
  registered_count: number
  open: boolean
}

const KIND_LABEL: Record<string, string> = {
  alumni: '🎓 Alumni Table',
  dropin: '🔄 Drop-In Table',
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const router = useRouter()

  async function load(uid: string) {
    const supabase = createClient()
    const [{ data: sessionData, error: sessionError }, { data: regData }] = await Promise.all([
      supabase
        .from('signup_sessions')
        .select('*')
        .gte('session_date', new Date().toISOString())
        .order('session_date', { ascending: true }),
      supabase.from('signup_registrations').select('session_id').eq('user_id', uid),
    ])

    if (sessionError) console.error('sessions fetch failed:', sessionError.message)

    // Seat counts come from signup_sessions.registered_count, not from counting
    // these rows: RLS hands a member only their own registrations, so counting
    // locally would report every session as nearly empty.
    setSessions((sessionData || []) as Session[])
    setMine(new Set((regData || []).map(r => r.session_id)))
  }

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      await load(user.id)
      setLoading(false)
    }
    init()
  }, [router])

  async function toggle(session: Session) {
    setWorking(session.id)
    setError(null)
    const supabase = createClient()

    if (mine.has(session.id)) {
      const { error: err } = await supabase
        .from('signup_registrations')
        .delete()
        .eq('session_id', session.id)
        .eq('user_id', userId)
      if (err) {
        console.error('withdraw failed:', err.message)
        setError({ id: session.id, message: "Couldn't cancel — try again" })
      } else {
        setMine(m => { const s = new Set(m); s.delete(session.id); return s })
        setSessions(p => p.map(s => s.id === session.id
          ? { ...s, registered_count: Math.max(0, s.registered_count - 1) } : s))
      }
    } else {
      const { error: err } = await supabase
        .from('signup_registrations')
        .insert({ session_id: session.id, user_id: userId })
      if (err) {
        // "This session is full" and "closed for sign-ups" are raised by the
        // capacity trigger, so surface the database's own wording rather than
        // a generic failure the member cannot act on.
        console.error('signup failed:', err.message)
        setError({ id: session.id, message: friendlyError(err.message) })
      } else {
        setMine(m => new Set([...m, session.id]))
        setSessions(p => p.map(s => s.id === session.id
          ? { ...s, registered_count: s.registered_count + 1 } : s))
      }
    }
    setWorking(null)
  }

  function formatWhen(start: string, end: string | null) {
    const when = new Date(start).toLocaleString('en-US', {
      weekday: 'short', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
    if (!end) return when
    return `${when} – ${new Date(end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Table Sign-Ups</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">Alumni tables and monthly drop-ins</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">
        {sessions.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">🪑</p>
            <p className="text-gray-500 font-medium">No sessions open right now</p>
            <p className="text-gray-400 text-sm mt-1">Check back soon</p>
          </div>
        )}

        {sessions.map(session => {
          const signedUp = mine.has(session.id)
          const seatsLeft = session.capacity === null
            ? null
            : session.capacity - (session.registered_count || 0)
          const full = seatsLeft !== null && seatsLeft <= 0 && !signedUp
          const closed = !session.open

          return (
            <div key={session.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className={`h-1.5 ${session.kind === 'alumni' ? 'bg-bt-blue' : 'bg-amber-500'}`} />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-bt-pale text-bt-navy">
                    {KIND_LABEL[session.kind] || session.kind}
                  </span>
                  {closed && (
                    <span className="text-xs font-semibold text-gray-400">Closed</span>
                  )}
                  {!closed && seatsLeft !== null && (
                    <span className={`text-xs font-semibold ${seatsLeft <= 2 ? 'text-orange-500' : 'text-gray-400'}`}>
                      {seatsLeft > 0 ? `${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left` : 'Full'}
                    </span>
                  )}
                </div>

                <h3 className="font-bold text-gray-900 text-base leading-tight">{session.title}</h3>
                <p className="text-gray-400 text-xs mt-1">{formatWhen(session.session_date, session.end_date)}</p>
                {session.location && (
                  <p className="text-gray-500 text-sm mt-1">📍 {session.location}</p>
                )}
                {session.description && (
                  <p className="text-gray-500 text-sm mt-2 leading-relaxed">{session.description}</p>
                )}

                <button
                  onClick={() => toggle(session)}
                  disabled={working === session.id || (!signedUp && (full || closed))}
                  className={`w-full mt-4 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-40 ${
                    signedUp
                      ? 'bg-bt-navy text-white'
                      : 'bg-bt-pale text-bt-navy border border-bt-navy/20'
                  }`}>
                  {working === session.id
                    ? '...'
                    : signedUp ? "✓ You're signed up" : closed ? 'Closed' : full ? 'Full' : 'Sign up'}
                </button>

                {signedUp && (
                  <p className="text-center text-gray-400 text-xs mt-2">Tap again to cancel</p>
                )}
                {error?.id === session.id && (
                  <p className="text-center text-red-600 text-xs mt-2">{error.message}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <BottomNav />
    </div>
  )
}

function friendlyError(message: string) {
  if (/full/i.test(message)) return 'That session just filled up'
  if (/closed/i.test(message)) return 'Sign-ups have closed for this session'
  if (/duplicate|unique/i.test(message)) return "You're already signed up"
  return "Couldn't sign you up — try again"
}
