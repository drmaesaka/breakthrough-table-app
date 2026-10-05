'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { linkify, hasLink } from '@/lib/linkify'
import { localDay } from '@/lib/dates'
import { calcAdherence, datesByHabit, streakFor, doneInPeriod, periodKey, freqOf, FREQ_LABEL, type Habit, type Frequency } from '@/lib/habits'

// Your own habits and reading. Lived on its own Tasks tab until 2026-10-05,
// when it moved to the top of My Table so "me" and "my table" are one place.
export default function MyTasks() {
  const [tasks, setTasks] = useState<any[]>([])
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [habits, setHabits] = useState<Habit[]>([])
  /** Habit id → every day it was logged (YYYY-MM-DD), for the calendar. */
  const [historyByHabit, setHistoryByHabit] = useState<Map<string, Set<string>>>(new Map())
  const [showHistory, setShowHistory] = useState(false)
  /** Inline "add a habit" — leaders asked for a plus button here instead of a trip to Profile. */
  const [adding, setAdding] = useState(false)
  const [newHabit, setNewHabit] = useState('')
  const [newFreq, setNewFreq] = useState<Frequency>('daily')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')
  /** First day of the month the calendar is showing. */
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  /** Habit ids logged today. */
  const [doneToday, setDoneToday] = useState<Set<string>>(new Set())
  /** Habit id → consecutive days. Separate per habit, so one lapsing leaves the rest alone. */
  const [streaks, setStreaks] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const [periodLabel, setPeriodLabel] = useState('Current')
  const [streak, setStreak] = useState(0)
  /** Which habit just got ticked, for the streak flourish. */
  const [justDone, setJustDone] = useState<string | null>(null)
  const router = useRouter()

  const today = localDay()

  useEffect(() => { loadTasks() }, [])

  async function loadTasks() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    setUserId(user.id)

    const { data: prof } = await supabase
      .from('profiles')
      .select('group_id, streak')
      .eq('id', user.id)
      .single()

    if (!prof?.group_id) { setLoading(false); return }
    setStreak(prof.streak || 0)

    // 60 days of completions covers any streak worth displaying and is one
    // query instead of one per habit.
    const [{ data: taskData }, { data: completions }, { data: habitRows }, { data: habitLog }] = await Promise.all([
      supabase.from('tasks').select('*').eq('group_id', prof.group_id).eq('archived', false).order('created_at', { ascending: false }),
      supabase.from('task_completions').select('task_id, tasks!inner(archived)').eq('user_id', user.id).eq('tasks.archived', false),
      supabase.from('habits').select('*').eq('user_id', user.id).is('archived_at', null).order('created_at', { ascending: true }),
      supabase.from('habit_completions').select('habit_id, completed_date').eq('user_id', user.id).order('completed_date', { ascending: false }).limit(400),
    ])

    setTasks(taskData || [])
    if (taskData && taskData.length > 0) setPeriodLabel(taskData[0].period_label || 'Current')
    setCompletedIds(new Set(completions?.map((c: any) => c.task_id)))

    const live = (habitRows || []) as Habit[]
    setHabits(live)

    const log = (habitLog || []) as { habit_id: string | null; completed_date: string }[]
    const byHabit = datesByHabit(log)
    setHistoryByHabit(byHabit)
    // "Done" means done for the habit's own period — today, this week, or
    // this month — not only today.
    const done = new Set<string>()
    const next = new Map<string, number>()
    for (const h of live) {
      const dates = byHabit.get(h.id) ?? new Set<string>()
      const f = freqOf(h)
      const isDone = doneInPeriod(dates, f, today)
      if (isDone) done.add(h.id)
      next.set(h.id, streakFor(dates, isDone, new Date(), f))
    }
    setDoneToday(done)
    setStreaks(next)

    setLoading(false)
  }

  async function toggleTask(taskId: string) {
    const supabase = createClient()
    const isCompleted = completedIds.has(taskId)
    const newSet = new Set(completedIds)

    if (isCompleted) {
      await supabase.from('task_completions').delete().eq('task_id', taskId).eq('user_id', userId)
      newSet.delete(taskId)
    } else {
      await supabase.from('task_completions').insert({ task_id: taskId, user_id: userId })
      newSet.add(taskId)
    }

    setCompletedIds(newSet)
    const adherence = calcAdherence(newSet.size, doneToday.size, tasks.length, habits.length)

    // Streak is credited once per period when the leader rolls the period over,
    // not here — incrementing on each toggle meant unchecking and rechecking an
    // item inflated it every time.
    await supabase.from('profiles').update({ adherence_percent: adherence }).eq('id', userId)
  }

  async function addHabit() {
    const name = newHabit.trim()
    if (!name) return
    if (habits.some(h => h.name.toLowerCase() === name.toLowerCase())) { setAddError('You already have that habit'); return }
    setAddSaving(true); setAddError('')
    const supabase = createClient()
    let { data, error } = await supabase.from('habits').insert({ user_id: userId, name, frequency: newFreq }).select().single()
    // Before the 2026-09-29 migration the column does not exist: save as daily.
    if (error && /frequency/.test(error.message)) {
      ;({ data, error } = await supabase.from('habits').insert({ user_id: userId, name }).select().single())
    }
    setAddSaving(false)
    if (error) { setAddError("Couldn't save — try again"); return }
    setHabits(prev => [...prev, data as Habit])
    setStreaks(prev => new Map(prev).set(data.id, 0))
    setNewHabit(''); setNewFreq('daily'); setAdding(false)
  }

  async function toggleHabit(habitId: string) {
    const supabase = createClient()
    const wasDone = doneToday.has(habitId)
    const nextDone = new Set(doneToday)

    // Delete is scoped to the habit as well as the day. Without habit_id it
    // would clear every habit the member logged today.
    const habit = habits.find(h => h.id === habitId)
    const f = freqOf(habit || {})
    if (wasDone) {
      // Un-tick clears every check-in in the current period, so a weekly
      // habit ticked on Tuesday can still be un-ticked on Thursday.
      const dates = [...(historyByHabit.get(habitId) || [])].filter(d => periodKey(d, f) === periodKey(today, f))
      await supabase.from('habit_completions')
        .delete().eq('user_id', userId).eq('habit_id', habitId).in('completed_date', dates.length ? dates : [today])
      nextDone.delete(habitId)
      setStreaks(prev => new Map(prev).set(habitId, Math.max(0, (prev.get(habitId) || 0) - 1)))
      setHistoryByHabit(prev => { const m = new Map(prev); const d = new Set(m.get(habitId) || []); for (const x of dates) d.delete(x); m.set(habitId, d); return m })
    } else {
      await supabase.from('habit_completions')
        .insert({ user_id: userId, habit_id: habitId, completed_date: today })
      nextDone.add(habitId)
      setStreaks(prev => new Map(prev).set(habitId, (prev.get(habitId) || 0) + 1))
      setHistoryByHabit(prev => { const m = new Map(prev); const d = new Set(m.get(habitId) || []); d.add(today); m.set(habitId, d); return m })
      setJustDone(habitId)
      setTimeout(() => setJustDone(null), 3000)
    }

    setDoneToday(nextDone)
    const adherence = calcAdherence(completedIds.size, nextDone.size, tasks.length, habits.length)
    await supabase.from('profiles').update({ adherence_percent: adherence }).eq('id', userId)
  }

  const adherence = calcAdherence(completedIds.size, doneToday.size, tasks.length, habits.length)
  const allDone = tasks.length > 0 && completedIds.size === tasks.length
    && habits.length > 0 && doneToday.size === habits.length

  return (
      <div className="space-y-4">
        {allDone && (
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 text-center">
            <p className="text-4xl mb-2">🎉</p>
            <p className="font-bold text-green-700 text-lg">You crushed it!</p>
            <p className="text-green-600 text-sm mt-1">
              Everything done this period. Your table sees it.{streak > 1 ? ` ${streak} periods in a row! 🔥` : ' Keep it up.'}
            </p>
          </div>
        )}

        {loading && <p className="text-center text-gray-400 py-10">Loading...</p>}

        {!loading && (
          <>
            {/* Daily Habits — each tracked separately, each with its own
                streak. Mo's rule 2026-08-24: one lapsing must not reset the
                others, so nothing here aggregates across habits. */}
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                  Daily Habit{habits.length === 1 ? '' : 's'}
                </p>
                <div className="flex gap-3 items-center">
                  {habits.length > 0 && (
                    <button onClick={() => setShowHistory(v => !v)} className="text-bt-blue text-xs font-semibold">
                      {showHistory ? 'Hide calendar' : '📅 Calendar'}
                    </button>
                  )}
                  {habits.length > 0 && <a href="/profile" className="text-bt-blue text-xs font-semibold">Manage</a>}
                  <button onClick={() => { setAdding(v => !v); setAddError('') }} aria-label="Add a habit"
                    className="w-7 h-7 rounded-full bg-bt-navy text-white text-lg leading-none font-bold flex items-center justify-center">
                    {adding ? '×' : '+'}
                  </button>
                </div>
              </div>

              {adding && (
                <div className="bg-white rounded-2xl p-4 shadow-sm mb-3 space-y-2">
                  <p className="text-xs text-gray-400 font-medium">New daily habit</p>
                  <div className="flex gap-2">
                    <input autoFocus value={newHabit} onChange={e => setNewHabit(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addHabit(); if (e.key === 'Escape') setAdding(false) }}
                      placeholder="e.g. Read 10 pages"
                      className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue" />
                    <button onClick={addHabit} disabled={addSaving || !newHabit.trim()}
                      className="px-4 py-3 rounded-xl bg-bt-navy text-white text-sm font-semibold disabled:opacity-40">
                      {addSaving ? '...' : 'Add'}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {(['daily', 'weekly', 'monthly'] as Frequency[]).map(f => (
                      <button key={f} type="button" onClick={() => setNewFreq(f)}
                        className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 capitalize ${newFreq === f ? 'border-bt-navy bg-bt-pale text-bt-navy' : 'border-gray-100 text-gray-500'}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                  {addError && <p className="text-xs text-red-600">{addError}</p>}
                  <p className="text-[11px] text-gray-400">
                    {newFreq === 'daily' ? 'Check in every day.' : newFreq === 'weekly' ? 'Check in once a week (Mon–Sun). Reminders start Friday.' : 'Check in once a month. Reminders in the last few days.'}
                    {' '}Each habit keeps its own streak.
                  </p>
                </div>
              )}

              {/* Month view, one grid per habit. Leaders asked for more than
                  "just today". View only: back-filling old days would let a
                  streak be repaired after the fact, which defeats it. */}
              {showHistory && habits.length > 0 && (() => {
                const y = calMonth.getFullYear(), m = calMonth.getMonth()
                const daysInMonth = new Date(y, m + 1, 0).getDate()
                const firstDow = new Date(y, m, 1).getDay()
                const pad = (n: number) => String(n).padStart(2, '0')
                const key = (d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
                const todayKey = today
                const isCurrentMonth = todayKey.startsWith(`${y}-${pad(m + 1)}`)
                const dayCount = isCurrentMonth ? Number(todayKey.slice(-2)) : daysInMonth
                const monthLabel = calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                const canForward = !isCurrentMonth && calMonth < new Date()
                return (
                  <div className="bg-white rounded-2xl p-4 shadow-sm mb-3 space-y-4">
                    <div className="flex items-center justify-between">
                      <button onClick={() => setCalMonth(new Date(y, m - 1, 1))} className="w-8 h-8 rounded-full bg-bt-pale text-bt-navy font-bold">‹</button>
                      <p className="font-semibold text-bt-navy text-sm">{monthLabel}</p>
                      <button onClick={() => setCalMonth(new Date(y, m + 1, 1))} disabled={!canForward}
                        className="w-8 h-8 rounded-full bg-bt-pale text-bt-navy font-bold disabled:opacity-30">›</button>
                    </div>
                    {habits.map(h => {
                      const dates = historyByHabit.get(h.id) || new Set<string>()
                      let done = 0
                      for (let d = 1; d <= dayCount; d++) if (dates.has(key(d))) done++
                      // Days since the habit was created count as "possible";
                      // before that the box is blank, not a miss.
                      const createdKey = h.created_at ? String(h.created_at).slice(0, 10) : ''
                      return (
                        <div key={h.id}>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-sm font-semibold text-gray-900 truncate">{h.name}</p>
                            <p className="text-xs text-gray-400 flex-shrink-0">{done} of {dayCount} day{dayCount === 1 ? '' : 's'}</p>
                          </div>
                          <div className="grid grid-cols-7 gap-1 text-center">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                              <span key={i} className="text-[10px] text-gray-300 font-semibold">{d}</span>
                            ))}
                            {Array.from({ length: firstDow }).map((_, i) => <span key={`pad-${i}`} />)}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                              const d = i + 1
                              const k = key(d)
                              const isToday = k === todayKey
                              const future = k > todayKey
                              const beforeStart = createdKey && k < createdKey
                              const hit = dates.has(k)
                              return (
                                <span key={k} title={k}
                                  className={`h-7 rounded-lg flex items-center justify-center text-[11px] font-semibold ${
                                    hit ? 'bg-bt-navy text-white'
                                    : future || beforeStart ? 'text-gray-200'
                                    : 'bg-gray-50 text-gray-400'
                                  } ${isToday ? 'ring-2 ring-bt-blue' : ''}`}>
                                  {d}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                    <p className="text-[11px] text-gray-400">Filled = checked in that day. Today has a blue ring. Past days can’t be edited — that’s what keeps a streak honest.</p>
                  </div>
                )
              })()}

              {justDone && (streaks.get(justDone) || 0) > 0 && (
                <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-4 text-center mb-3">
                  <p className="text-3xl mb-1">🔥</p>
                  <p className="font-bold text-orange-700">
                    {(streaks.get(justDone) || 0) > 1
                      ? `${streaks.get(justDone)} ${FREQ_LABEL[freqOf(habits.find(h => h.id === justDone) || {})].noun}s in a row!`
                      : 'Habit done!'}
                  </p>
                  <p className="text-orange-500 text-xs mt-0.5">Keep the streak alive next {FREQ_LABEL[freqOf(habits.find(h => h.id === justDone) || {})].noun}</p>
                </div>
              )}

              {habits.length === 0 ? (
                !adding && (
                  <button onClick={() => setAdding(true)} className="w-full bg-white rounded-2xl p-4 shadow-sm text-center">
                    <p className="text-gray-400 text-sm">No habit set yet</p>
                    <p className="text-bt-blue text-sm font-semibold mt-1">+ Add your first habit</p>
                  </button>
                )
              ) : (
                <div className="space-y-3">
                  {habits.map(h => {
                    const done = doneToday.has(h.id)
                    const days = streaks.get(h.id) || 0
                    const atRisk = !done && days > 0
                    return (
                      <button key={h.id} onClick={() => toggleHabit(h.id)}
                        className={`w-full bg-white rounded-2xl p-4 shadow-sm flex items-start gap-4 text-left transition-opacity ${done ? 'opacity-60' : ''}`}>
                        <div className={`mt-0.5 w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          done ? 'bg-bt-navy border-bt-navy' : 'border-gray-300'
                        }`}>
                          {done && (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                              <path d="M20 6L9 17l-5-5"/>
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-semibold text-gray-900 ${done ? 'line-through text-gray-400' : ''}`}>
                            {h.name}
                          </p>
                          {days > 0 ? (
                            <p className={`text-xs mt-0.5 font-semibold ${atRisk ? 'text-gray-400' : 'text-orange-500'}`}>
                              🔥 {days} {FREQ_LABEL[freqOf(h)].noun}{days !== 1 ? 's' : ''}{atRisk ? ` — check in ${FREQ_LABEL[freqOf(h)].period} to keep it` : ''}
                            </p>
                          ) : (
                            <p className="text-gray-400 text-xs mt-0.5">{FREQ_LABEL[freqOf(h)].checkIn}</p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Reading Section */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 px-1">Reading & Resources</p>
              {tasks.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-4xl mb-3">📚</p>
                  <p className="text-gray-500 font-medium">No reading assigned yet</p>
                  <p className="text-gray-400 text-sm mt-1">Your leader will post material here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map(task => {
                    const done = completedIds.has(task.id)
                    return (
                      // A div, not one big button: a link inside the text has
                      // to be tappable without ticking the item.
                      <div key={task.id} onClick={() => toggleTask(task.id)} role="button"
                        className={`w-full bg-white rounded-2xl p-4 shadow-sm flex items-start gap-4 text-left transition-opacity cursor-pointer ${done ? 'opacity-60' : ''}`}>
                        <div className={`mt-0.5 w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          done ? 'bg-bt-navy border-bt-navy' : 'border-gray-300'
                        }`}>
                          {done && (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                              <path d="M20 6L9 17l-5-5"/>
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-semibold text-gray-900 break-words ${done ? 'line-through text-gray-400' : ''}`}>{linkify(task.title)}</p>
                          {task.description && <p className="text-gray-400 text-sm mt-1 leading-relaxed break-words">{linkify(task.description)}</p>}
                          {(hasLink(task.title) || hasLink(task.description)) && (
                            <p className="text-[11px] text-gray-300 mt-1">Tap the link to open it · tap anywhere else to mark done</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
  )
}
