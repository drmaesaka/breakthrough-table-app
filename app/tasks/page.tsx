'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import { localDay } from '@/lib/dates'
import { calcAdherence, datesByHabit, streakFor, type Habit } from '@/lib/habits'

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [habits, setHabits] = useState<Habit[]>([])
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
    setDoneToday(new Set(log.filter(c => c.completed_date === today && c.habit_id).map(c => c.habit_id as string)))

    const byHabit = datesByHabit(log)
    const next = new Map<string, number>()
    for (const h of live) {
      const dates = byHabit.get(h.id) ?? new Set<string>()
      next.set(h.id, streakFor(dates, dates.has(today)))
    }
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

  async function toggleHabit(habitId: string) {
    const supabase = createClient()
    const wasDone = doneToday.has(habitId)
    const nextDone = new Set(doneToday)

    // Delete is scoped to the habit as well as the day. Without habit_id it
    // would clear every habit the member logged today.
    if (wasDone) {
      await supabase.from('habit_completions')
        .delete().eq('user_id', userId).eq('habit_id', habitId).eq('completed_date', today)
      nextDone.delete(habitId)
      setStreaks(prev => new Map(prev).set(habitId, Math.max(0, (prev.get(habitId) || 0) - 1)))
    } else {
      await supabase.from('habit_completions')
        .insert({ user_id: userId, habit_id: habitId, completed_date: today })
      nextDone.add(habitId)
      setStreaks(prev => new Map(prev).set(habitId, (prev.get(habitId) || 0) + 1))
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
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-white text-2xl font-bold">My Tasks</h1>
            <p className="text-bt-light/70 text-sm mt-0.5">{periodLabel} period</p>
          </div>
          {streak > 0 && (
            <div className="text-right">
              <p className="text-2xl">🔥</p>
              <p className="text-white text-sm font-bold">{streak} period{streak !== 1 ? 's' : ''}</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-bt-light rounded-full transition-all duration-500" style={{ width: `${adherence}%` }} />
          </div>
          <span className="text-white text-sm font-bold w-10 text-right">{adherence}%</span>
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">
        {allDone && (
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 text-center">
            <p className="text-4xl mb-2">🎉</p>
            <p className="font-bold text-green-700 text-lg">You crushed it!</p>
            <p className="text-green-600 text-sm mt-1">
              100% this period. Your table sees it.{streak > 1 ? ` ${streak} periods in a row! 🔥` : ' Keep it up.'}
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
                {habits.length > 0 && (
                  <a href="/profile" className="text-bt-blue text-xs font-semibold">Manage</a>
                )}
              </div>

              {justDone && (streaks.get(justDone) || 0) > 0 && (
                <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-4 text-center mb-3">
                  <p className="text-3xl mb-1">🔥</p>
                  <p className="font-bold text-orange-700">
                    {(streaks.get(justDone) || 0) > 1
                      ? `${streaks.get(justDone)} days in a row!`
                      : 'Habit done!'}
                  </p>
                  <p className="text-orange-500 text-xs mt-0.5">Keep the streak alive tomorrow</p>
                </div>
              )}

              {habits.length === 0 ? (
                <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
                  <p className="text-gray-400 text-sm">No habit set yet</p>
                  <a href="/profile" className="text-bt-blue text-sm font-semibold mt-1 block">Set your habit →</a>
                </div>
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
                              🔥 {days} day{days !== 1 ? 's' : ''}{atRisk ? ' — check in to keep it' : ''}
                            </p>
                          ) : (
                            <p className="text-gray-400 text-xs mt-0.5">Daily check-in</p>
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
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 px-1">Reading & Homework</p>
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
                      <button key={task.id} onClick={() => toggleTask(task.id)}
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
                        <div className="flex-1">
                          <p className={`font-semibold text-gray-900 ${done ? 'line-through text-gray-400' : ''}`}>{task.title}</p>
                          {task.description && <p className="text-gray-400 text-sm mt-1 leading-relaxed">{task.description}</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
