'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import PushSetupBanner from '@/components/PushSetupBanner'
import WelcomeScreen from '@/components/WelcomeScreen'
import { myTables, type MyTable } from '@/lib/other-tables'
import { freqOf, doneInPeriod, type Frequency } from '@/lib/habits'
import { localDay } from '@/lib/dates'
import { linkify } from '@/lib/linkify'
import { MEETING_PLANS, resolveMeetingPlans, type StoredMeetingPlan } from '@/lib/meeting-plans'

export default function DashboardPage() {
  const [profile, setProfile] = useState<any>(null)
  const [groupName, setGroupName] = useState('')
  const [tables, setTables] = useState<MyTable[]>([])
  const [tableId, setTableId] = useState<string | null>(null)
  /**
   * "Your BT Journey": the table's meetings and which ones this member was
   * at. Replaces the adherence percentage, which started every period at 0
   * and read as failure. See sql/2026-09-03-attendance.sql.
   */
  const [journey, setJourney] = useState<{
    meetings: { number: number; title: string; resources: string[]; challenges: string[] }[]
    attended: Set<number>
    current: number | null
    /** Meeting the table should be on, from its programme start date at one meeting per fortnight. */
    expected: number | null
    startDate: string | null
  } | null>(null)
  /**
   * "This week": what is in front of the member right now. Replaced the
   * 12-meeting progress bar (2026-10-05): a bar that fills up says "done",
   * and the programme wants people staying well past six months. Nothing
   * here ever reaches 100%; the counts at the bottom only go up.
   */
  const [week, setWeek] = useState<{
    habits: { id: string; name: string; freq: Frequency; done: boolean }[]
    /** null on a table the TC leads but does not sit at: not theirs to do. */
    readingLeft: { id: string; title: string }[] | null
    readingTotal: number
    prompt: { id: string; prompt: string } | null
    reflections: number
    attended: number
  } | null>(null)
  const router = useRouter()

  // The member's own goal, pinned on Home: the reason they came, and the
  // strongest reason to stay. profiles.goal (sql/2026-10-05-member-goal.sql).
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  const [goalSaving, setGoalSaving] = useState(false)
  const [goalError, setGoalError] = useState('')

  async function saveGoal() {
    const goal = goalDraft.trim()
    if (!profile) return
    setGoalSaving(true); setGoalError('')
    // .select() so an update RLS filters to nothing is caught, not reported as saved.
    const { data, error } = await createClient().from('profiles').update({ goal: goal || null }).eq('id', profile.id).select('goal')
    setGoalSaving(false)
    if (error || !data?.length) {
      setGoalError(error && /goal/.test(error.message) ? "Goals aren't switched on yet. Try again later." : "Couldn't save. Try again.")
      return
    }
    setProfile((p: any) => ({ ...p, goal: goal || null }))
    setEditingGoal(false)
  }

  async function loadWeek(userId: string, t: MyTable) {
    const supabase = createClient()
    const fiveWeeksAgo = localDay(new Date(Date.now() - 35 * 86400000))
    const [{ data: habits }, { data: hc }, { count: reflections }, { count: attended }, tasksRes, doneRes, promptsRes, myRespRes] = await Promise.all([
      supabase.from('habits').select('id, name, frequency').eq('user_id', userId).is('archived_at', null).order('created_at', { ascending: true }),
      supabase.from('habit_completions').select('habit_id, completed_date').eq('user_id', userId).gte('completed_date', fiveWeeksAgo),
      supabase.from('journal_responses').select('prompt_id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('meeting_attendance').select('user_id', { count: 'exact', head: true }).eq('user_id', userId),
      t.home ? supabase.from('tasks').select('id, title').eq('group_id', t.id).eq('archived', false).order('created_at', { ascending: true }) : Promise.resolve({ data: null }),
      t.home ? supabase.from('task_completions').select('task_id').eq('user_id', userId) : Promise.resolve({ data: null }),
      t.home ? supabase.from('journal_prompts').select('id, prompt').eq('group_id', t.id).order('created_at', { ascending: false }).limit(10) : Promise.resolve({ data: null }),
      t.home ? supabase.from('journal_responses').select('prompt_id').eq('user_id', userId) : Promise.resolve({ data: null }),
    ])
    const today = localDay()
    const dates = new Map<string, Set<string>>()
    for (const c of hc || []) {
      if (!c.habit_id) continue
      dates.set(c.habit_id, (dates.get(c.habit_id) ?? new Set<string>()).add(c.completed_date))
    }
    const doneIds = new Set((doneRes.data || []).map((r: any) => r.task_id))
    const answered = new Set((myRespRes.data || []).map((r: any) => r.prompt_id))
    const tasks = (tasksRes.data || []) as { id: string; title: string }[]
    setWeek({
      habits: (habits || []).map((h: any) => ({ id: h.id, name: h.name, freq: freqOf(h), done: doneInPeriod(dates.get(h.id) ?? new Set(), freqOf(h), today) })),
      readingLeft: t.home ? tasks.filter(x => !doneIds.has(x.id)) : null,
      readingTotal: tasks.length,
      prompt: ((promptsRes.data || []) as { id: string; prompt: string }[]).find(p => !answered.has(p.id)) || null,
      reflections: reflections || 0,
      attended: attended || 0,
    })
  }

  /** The journey for one table: its meetings, where it is, and which ones I attended there. */
  async function loadJourney(userId: string, t: MyTable) {
    const supabase = createClient()
    const plansPromise = t.home
      // RLS hands back the BT defaults plus this table's overrides.
      ? supabase.from('meeting_plans').select('group_id, number, title, resources, challenges').order('number', { ascending: true }).then(r => r.data)
      // A table I lead but do not sit at: RLS will not show its overrides.
      : (async () => {
          const { data: { session } } = await supabase.auth.getSession()
          const res = await fetch(`/api/admin/meeting-plans?group_id=${encodeURIComponent(t.id)}`, { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
          if (!res.ok) return null
          const j = await res.json()
          return [...(j.defaults || []), ...(j.overrides || [])]
        })()
    const [planRows, { data: attendedRows, error: attendanceError }] = await Promise.all([
      plansPromise,
      supabase.from('meeting_attendance').select('meeting_number').eq('user_id', userId).eq('group_id', t.id),
    ])
    // Before the attendance migration the table does not exist; the
    // journey still renders, with nothing filled in yet.
    if (attendanceError) console.error('attendance fetch failed:', attendanceError.message)
    const resolved = planRows && planRows.length
      ? resolveMeetingPlans(planRows as StoredMeetingPlan[])
      : (MEETING_PLANS as StoredMeetingPlan[])
    // Tables join the app months into the programme. The TC's start date
    // plus the fortnightly cadence says where the table really is; a
    // marked current meeting or attendance can only move that forward.
    const startDate: string | null = t.program_start_date || null
    let expected: number | null = null
    if (startDate) {
      const days = Math.floor((Date.now() - new Date(startDate + 'T12:00:00').getTime()) / 86400000)
      const last = resolved.filter(m => m.number >= 1).slice(-1)[0]?.number ?? 12
      expected = Math.max(1, Math.min(last, Math.floor(days / 14) + 1))
    }
    setJourney({
      meetings: resolved.map(m => ({ number: m.number, title: m.title, resources: m.resources || [], challenges: m.challenges || [] })),
      attended: new Set((attendedRows || []).map((r: any) => r.meeting_number as number)),
      current: t.current_meeting_number ?? null,
      expected,
      startDate,
    })
  }

  async function switchTable(id: string) {
    const t = tables.find(x => x.id === id)
    if (!t || !profile) return
    setTableId(id); setGroupName(t.name)
    await Promise.all([loadJourney(profile.id, t), loadWeek(profile.id, t)])
  }

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase.from('profiles').select('*, groups(name, current_meeting_number, program_start_date), streak').eq('id', user.id).single()
      if (prof) {
        setProfile(prof)
        setGroupName(prof.groups?.name || '')
      }
      if (prof?.group_id) {
        const home = { id: prof.group_id, name: prof.groups?.name || 'My table', current_meeting_number: prof.groups?.current_meeting_number ?? null, program_start_date: prof.groups?.program_start_date ?? null }
        setTableId(home.id)
        await Promise.all([loadJourney(user.id, { ...home, home: true }), loadWeek(user.id, { ...home, home: true })])
        if (prof.role === 'leader') myTables(home, true).then(setTables)
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
            {tables.length > 1 ? (
              <select value={tableId || ''} onChange={e => switchTable(e.target.value)}
                className="mt-2 max-w-full bg-white/15 text-white text-sm font-semibold rounded-xl px-3 py-1.5 border border-white/25 focus:outline-none">
                {tables.map(t => <option key={t.id} value={t.id} className="text-gray-900">🪑 {t.name}{t.home ? ' (your table)' : ''}</option>)}
              </select>
            ) : groupName && <p className="text-bt-light/70 text-sm mt-1">🪑 Your table: <span className="text-white font-semibold">{groupName}</span></p>}
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
            {journey && week && (() => {
              const onHome = !tableId || tableId === profile?.group_id
              const maxAttended = Math.max(0, ...[...journey.attended])
              // Where the table is: the TC's marked meeting, the furthest one
              // attended, or the programme start date at one per fortnight.
              const candidates = [journey.current ?? 0, maxAttended, journey.expected ?? 0].filter(n => n > 0)
              const here = candidates.length ? Math.max(...candidates) : null
              const numbered = journey.meetings.filter(m => m.number >= 1)
              // The next one to sit: the current meeting until attended, then the one after.
              const upcoming = here === null ? numbered[0]
                : !journey.attended.has(here) ? numbered.find(m => m.number === here)
                : numbered.find(m => m.number > here)
              // Next table date from the start date and the fortnightly rhythm.
              let nextDate: Date | null = null
              if (journey.startDate) {
                const start = new Date(journey.startDate + 'T12:00:00')
                const today = new Date(); today.setHours(12, 0, 0, 0)
                const days = Math.round((today.getTime() - start.getTime()) / 86400000)
                nextDate = new Date(start)
                nextDate.setDate(start.getDate() + Math.max(0, Math.ceil(days / 14)) * 14)
              }
              const isToday = nextDate && localDay(nextDate) === localDay()
              const missed = onHome && here !== null
                ? numbered.filter(m => m.number < here && !journey.attended.has(m.number)).slice(-1)[0]
                : undefined
              const row = 'flex items-start gap-3 py-2.5'
              const challenges = upcoming?.challenges || []
              const resources = upcoming?.resources || []
              const readingLeft = week.readingLeft || []
              const hasPrep = resources.length > 0 || readingLeft.length > 0 || !!week.prompt
              const dateLine = nextDate
                ? isToday ? 'Your table meets today' : nextDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                : null
              return (
                <>
                {/* Your goal — personal, so it shows whichever table is picked. */}
                <div className="bg-bt-navy rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-bt-light/70 text-xs font-bold uppercase tracking-wide">🎯 Your goal</p>
                    {profile?.goal && !editingGoal && (
                      <button onClick={() => { setGoalDraft(profile.goal); setEditingGoal(true); setGoalError('') }} className="text-bt-light/70 text-xs font-semibold">Edit</button>
                    )}
                  </div>
                  {editingGoal || !profile?.goal ? (
                    editingGoal ? (
                      <div className="mt-2 space-y-2">
                        <textarea autoFocus value={goalDraft} onChange={e => setGoalDraft(e.target.value)} rows={3} maxLength={300}
                          placeholder="e.g. Grow my business to $1M while being home for dinner every night"
                          className="w-full rounded-xl px-3 py-2 text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-bt-light" />
                        <div className="flex gap-2">
                          <button onClick={saveGoal} disabled={goalSaving}
                            className="flex-1 bg-white text-bt-navy py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40">
                            {goalSaving ? 'Saving...' : 'Save goal'}
                          </button>
                          <button onClick={() => { setEditingGoal(false); setGoalError('') }} className="px-4 text-bt-light/70 text-sm">Cancel</button>
                        </div>
                        {goalError && <p className="text-xs text-red-300">{goalError}</p>}
                      </div>
                    ) : (
                      <button onClick={() => { setGoalDraft(''); setEditingGoal(true) }} className="mt-1 text-left">
                        <p className="text-white font-semibold">What are you here for?</p>
                        <p className="text-bt-light/70 text-sm mt-0.5">Write the goal from your goal card. It stays pinned here. <span className="text-white">Add it →</span></p>
                      </button>
                    )
                  ) : (
                    <p className="text-white text-lg font-semibold mt-1 leading-snug">{profile.goal}</p>
                  )}
                </div>

                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <p className="text-gray-400 text-xs font-medium">{groupName}</p>
                  <Link href="/meetings" className="block mt-0.5">
                    <p className="text-2xl font-bold text-bt-navy leading-tight">
                      {upcoming ? `Meeting ${upcoming.number}` : 'Your next meeting'}
                      {upcoming && <span className="text-gray-400 font-semibold"> · {upcoming.title}</span>}
                    </p>
                    {dateLine && <p className="text-sm text-gray-500 mt-1">🗓 {dateLine}</p>}
                  </Link>

                  {challenges.length > 0 && (
                    <div className="mt-4 bg-bt-pale rounded-xl p-3">
                      <p className="text-xs font-bold text-bt-navy uppercase tracking-wide">🎯 Your challenge</p>
                      <ul className="mt-1.5 space-y-1">
                        {challenges.slice(0, 3).map((c, i) => <li key={i} className="text-sm text-gray-800 leading-snug">• {linkify(c)}</li>)}
                      </ul>
                      {challenges.length > 3 && <Link href="/meetings" className="text-xs text-bt-blue font-medium mt-1.5 block">+{challenges.length - 3} more in the outline →</Link>}
                    </div>
                  )}

                  {hasPrep && (
                    <div className="mt-4">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Before your next meeting</p>
                      <div className="mt-1 divide-y divide-gray-100">
                        {resources.slice(0, 3).map((r, i) => (
                          <div key={i} className={row}>
                            <span className="text-lg">📎</span>
                            <p className="text-sm text-gray-800 leading-snug break-words">{linkify(r)}</p>
                          </div>
                        ))}
                        {resources.length > 3 && (
                          <Link href="/meetings" className="block py-2 text-xs text-bt-blue font-medium">+{resources.length - 3} more resources in the outline →</Link>
                        )}
                        {readingLeft.length > 0 && (
                          <Link href="/group" className={row}>
                            <span className="text-lg">📖</span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-bt-navy">{readingLeft.length} to read</p>
                              <p className="text-xs text-gray-500 mt-0.5 truncate">{readingLeft.slice(0, 2).map(r => r.title).join(' · ')}</p>
                            </div>
                          </Link>
                        )}
                        {week.prompt && (
                          <Link href="/journal" className={row}>
                            <span className="text-lg">🪞</span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-bt-navy">Answer the reflection</p>
                              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{week.prompt.prompt}</p>
                            </div>
                          </Link>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
                    <Link href="/group" className={row}>
                      <span className="text-lg">✅</span>
                      <div className="min-w-0 flex-1">
                        {week.habits.length === 0 ? (
                          <p className="text-sm font-semibold text-bt-navy">Pick a habit to work on <span className="text-bt-blue">→</span></p>
                        ) : week.habits.map(h => (
                          <p key={h.id} className={`text-sm ${h.done ? 'text-gray-400' : 'font-semibold text-bt-navy'}`}>
                            {h.done ? '✓' : '○'} {h.name} <span className="text-xs font-normal text-gray-400">{h.done ? 'done' : h.freq === 'daily' ? 'today' : h.freq === 'weekly' ? 'this week' : 'this month'}</span>
                          </p>
                        ))}
                      </div>
                    </Link>
                    {missed && (
                      <Link href="/meetings" className={row}>
                        <span className="text-lg">↩️</span>
                        <p className="text-xs text-gray-500">Missed Meeting {missed.number} · {missed.title}. <span className="text-bt-blue font-medium">Ask your TC to catch up →</span></p>
                      </Link>
                    )}
                  </div>

                  {(profile?.streak > 0 || week.attended > 0 || week.reflections > 0) && (
                    <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
                      {[
                        profile?.streak > 0 && `🔥 ${profile.streak} period streak`,
                        week.attended > 0 && `🪑 ${week.attended} table${week.attended === 1 ? '' : 's'} attended`,
                        week.reflections > 0 && `🪞 ${week.reflections} reflection${week.reflections === 1 ? '' : 's'} written`,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                </>
              )
            })()}

            <div className="grid grid-cols-2 gap-3">
              {[
                { href: '/group', emoji: '✅', title: 'My Table', sub: 'Habits, reading & your table' },
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