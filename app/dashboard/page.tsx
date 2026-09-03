'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import PushSetupBanner from '@/components/PushSetupBanner'
import WelcomeScreen from '@/components/WelcomeScreen'
import { MEETING_PLANS, resolveMeetingPlans, type StoredMeetingPlan } from '@/lib/meeting-plans'

export default function DashboardPage() {
  const [profile, setProfile] = useState<any>(null)
  const [groupName, setGroupName] = useState('')
  /**
   * "Your BT Journey": the table's meetings and which ones this member was
   * at. Replaces the adherence percentage, which started every period at 0
   * and read as failure. See sql/2026-09-03-attendance.sql.
   */
  const [journey, setJourney] = useState<{
    meetings: { number: number; title: string }[]
    attended: Set<number>
    current: number | null
  } | null>(null)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase.from('profiles').select('*, groups(name, current_meeting_number), streak').eq('id', user.id).single()
      if (prof) {
        setProfile(prof)
        setGroupName(prof.groups?.name || '')
      }

      if (prof?.group_id) {
        const [{ data: planRows }, { data: attendedRows, error: attendanceError }] = await Promise.all([
          // RLS hands back the BT defaults plus this table's overrides.
          supabase.from('meeting_plans').select('group_id, number, title').order('number', { ascending: true }),
          supabase.from('meeting_attendance').select('meeting_number').eq('user_id', user.id).eq('group_id', prof.group_id),
        ])
        // Before the attendance migration the table does not exist; the
        // journey still renders, with nothing filled in yet.
        if (attendanceError) console.error('attendance fetch failed:', attendanceError.message)
        const resolved = planRows && planRows.length
          ? resolveMeetingPlans(planRows as StoredMeetingPlan[])
          : (MEETING_PLANS as StoredMeetingPlan[])
        setJourney({
          meetings: resolved.map(m => ({ number: m.number, title: m.title })),
          attended: new Set((attendedRows || []).map((r: any) => r.meeting_number as number)),
          current: prof.groups?.current_meeting_number ?? null,
        })
      }
    }
    load()
  }, [router])

  const firstName = profile?.full_name?.split(' ')[0] || 'there'

  return (
    <div className="min-h-screen bg-bt-pale">
      {profile && <WelcomeScreen userId={profile.id} firstName={firstName} />}
      <div className="bg-bt-navy px-5 pt-16 pb-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-bt-light text-sm font-medium">Welcome back,</p>
            <h1 className="text-white text-3xl font-bold mt-0.5">{firstName} 👋</h1>
            {groupName && <p className="text-bt-light/70 text-sm mt-1">{groupName}</p>}
          </div>
          <Link href="/profile"
            className="mt-1 w-9 h-9 rounded-full bg-white/15 flex items-center justify-center">
            <span className="text-white text-xs font-bold">
              {(() => { const parts = (profile?.full_name || '').trim().split(' '); return parts.length >= 2 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : firstName.slice(0,2).toUpperCase() })()}
            </span>
          </Link>
        </div>
      </div>

      <div className="py-5 pb-28 space-y-4">
        <PushSetupBanner />
        <div className="px-5 space-y-4">
        {/* No group state */}
        {profile && !profile.group_id && (
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <p className="text-5xl mb-3">👋</p>
            <h2 className="font-bold text-bt-navy text-lg">You're all set!</h2>
            <p className="text-gray-400 text-sm mt-2 leading-relaxed">
              Your account is ready. You'll be added to your Breakthrough Table group shortly — your leader will assign you before your next meeting.
            </p>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-gray-400 text-xs">Questions? Reach out to your table leader.</p>
            </div>
          </div>
        )}

        {/* Sign-ups sit outside the has-a-table gate on purpose: alumni keep
            their account with no group_id, and the alumni table is for them. */}
        {profile && !profile.group_id && (
          <Link href="/sessions"
            className="bg-white rounded-2xl p-4 shadow-sm active:scale-95 transition-transform block">
            <div className="text-3xl mb-2">🪑</div>
            <p className="font-semibold text-bt-navy text-sm">Table Sign-Ups</p>
            <p className="text-gray-400 text-xs mt-0.5">Alumni & monthly drop-in tables</p>
          </Link>
        )}

        {/* Journey card + quick links - only show if in a group */}
        {profile?.group_id && (
          <>
            {/* Your BT Journey — the table's meetings, this member's attended
                ones filled in. No percentage: nothing here starts at zero. */}
            {journey && (() => {
              const numbered = journey.meetings.filter(m => m.number >= 1)
              const total = numbered.length || 12
              const maxAttended = Math.max(0, ...[...journey.attended])
              // Where the table is. If the TC has not marked a current meeting,
              // the furthest one this member attended stands in.
              const here = journey.current ?? (maxAttended || null)
              const current = here !== null ? journey.meetings.find(m => m.number === here) || null : null
              const next = here === null
                ? numbered[0] || null
                : numbered.find(m => m.number > here) || null
              const missed = numbered.filter(m => here !== null && m.number < here && !journey.attended.has(m.number))
              const status = (n: number) => {
                if (n === 0) return 'done'                       // onboarding: they are here, they did it
                if (journey.attended.has(n)) return 'done'
                if (here !== null && n === here) return 'current'
                if (here !== null && n < here) return 'missed'
                return 'ahead'
              }
              return (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <p className="text-gray-400 text-sm font-medium">Your BT Journey</p>
                  {current && current.number >= 1 ? (
                    <>
                      <p className="text-3xl font-bold text-bt-navy mt-1">Meeting {current.number} <span className="text-gray-300 text-xl font-semibold">of {total}</span></p>
                      <p className="text-gray-500 text-sm mt-0.5">{current.title}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-bt-navy mt-1">Your journey begins</p>
                      <p className="text-gray-500 text-sm mt-0.5">Onboarding ✓ · {total} meetings ahead</p>
                    </>
                  )}

                  {/* Timeline: onboarding + the numbered meetings */}
                  <div className="mt-4 relative">
                    <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-0.5 bg-gray-100" />
                    <div className="relative flex justify-between">
                      {journey.meetings.map(m => {
                        const st = status(m.number)
                        return (
                          <div key={m.number} title={`${m.number === 0 ? 'Onboarding' : `Meeting ${m.number}`} · ${m.title}`}
                            className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border-2 ${
                              st === 'done' ? 'bg-bt-navy border-bt-navy text-white'
                              : st === 'current' ? 'bg-white border-bt-blue text-bt-blue ring-4 ring-bt-blue/15'
                              : st === 'missed' ? 'bg-white border-gray-300 text-gray-400'
                              : 'bg-bt-pale border-bt-pale text-gray-300'
                            }`}>
                            {st === 'done' ? '✓' : m.number === 0 ? 'O' : m.number}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5">
                    {next ? (
                      <p className="text-sm text-gray-700"><span className="font-semibold">Next:</span> Meeting {next.number} · {next.title}</p>
                    ) : (
                      <p className="text-sm text-gray-700 font-semibold">Final meeting — you made it 🎉</p>
                    )}
                    {missed.map(m => (
                      <Link key={m.number} href="/meetings" className="block text-xs text-gray-400">
                        Missed Meeting {m.number} · {m.title}. <span className="text-bt-blue font-medium">Ask your TC to catch up →</span>
                      </Link>
                    ))}
                    {profile?.streak > 0 && (
                      <p className="text-xs text-gray-400">🔥 {profile.streak} period streak</p>
                    )}
                  </div>
                </div>
              )
            })()}

            <div className="grid grid-cols-2 gap-3">
              {[
                { href: '/tasks', emoji: '✅', title: 'My Tasks', sub: 'Track & complete' },
                // /journal had no inbound link anywhere, so reflection prompts
                // were only reachable by typing the URL.
                { href: '/journal', emoji: '📓', title: 'Reflections', sub: "Your table's prompts" },
                { href: '/events', emoji: '📅', title: 'Events', sub: 'Upcoming BT events' },
                { href: '/meetings', emoji: '🗒️', title: 'Meetings', sub: "This meeting's outline" },
                { href: '/sessions', emoji: '🪑', title: 'Sign-Ups', sub: 'Alumni & drop-in tables' },
                { href: '/library', emoji: '📚', title: 'Library', sub: 'Resources & videos' },
                { href: '/booking', emoji: '🏢', title: 'Book a Room', sub: 'Reserve your space' },
                { href: '/directory', emoji: '👥', title: 'Directory', sub: 'Find BT members' },
                { href: '/preferences', emoji: '🔔', title: 'Nudge Settings', sub: 'Customize check-ins' },
              ].map(card => (
                <Link key={card.href} href={card.href}
                  className="bg-white rounded-2xl p-4 shadow-sm active:scale-95 transition-transform block">
                  <div className="text-3xl mb-2">{card.emoji}</div>
                  <p className="font-semibold text-bt-navy text-sm">{card.title}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{card.sub}</p>
                </Link>
              ))}
            </div>
          </>
        )}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}