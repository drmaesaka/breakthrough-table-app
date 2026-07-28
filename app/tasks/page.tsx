'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import { localDay } from '@/lib/dates'

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [habitDoneToday, setHabitDoneToday] = useState(false)
  const [currentHabit, setCurrentHabit] = useState('')
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const [periodLabel, setPeriodLabel] = useState('Current')
  const [streak, setStreak] = useState(0)
  const [habitStreak, setHabitStreak] = useState(0)
  const [habitStreakAtRisk, setHabitStreakAtRisk] = useState(false)
  const [habitJustDone, setHabitJustDone] = useState(false)
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
      .select('group_id, streak, current_habit')
      .eq('id', user.id)
      .single()

    if (!prof?.group_id) { setLoading(false); return }
    setStreak(prof.streak || 0)
    setCurrentHabit(prof.current_habit || '')

    const [{ data: taskData }, { data: completions }, { data: habitToday }, { data: habitHistory }] = await Promise.all([
      supabase.from('tasks').select('*').eq('group_id', prof.group_id).eq('archived', false).order('created_at', { ascending: false }),
      supabase.from('task_completions').select('task_id, tasks!inner(archived)').eq('user_id', user.id).eq('tasks.archived', false),
      supabase.from('habit_completions').select('id').eq('user_id', user.id).eq('completed_date', today).maybeSingle(),
      supabase.from('habit_completions').select('completed_date').eq('user_id', user.id).order('completed_date', { ascending: false }).limit(60),
    ])

    setTasks(taskData || [])
    if (taskData && taskData.length > 0) setPeriodLabel(taskData[0].period_label || 'Current')
    setCompletedIds(new Set(completions?.map((c: any) => c.task_id)))
    setHabitDoneToday(!!habitToday)

    // Calculate habit streak. When today's check-in is still outstanding, count
    // back from yesterday instead — a run in progress should read as intact and
    // at risk, not collapse to 0 every morning before the member has tapped in.
    if (habitHistory && habitHistory.length > 0) {
      const dates = new Set(habitHistory.map((h: any) => h.completed_date))
      const doneToday = !!habitToday
      const d = new Date()
      if (!doneToday) d.setDate(d.getDate() - 1)
      let streak = 0
      while (dates.has(localDay(d))) {
        streak++
        d.setDate(d.getDate() - 1)
      }
      setHabitStreak(streak)
      setHabitStreakAtRisk(!doneToday && streak > 0)
    }

    setLoading(false)
  }

  function calcAdherence(completed: Set<string>, habitDone: boolean, totalTasks: number) {
    const total = totalTasks + 1 // +1 for habit
    const done = completed.size + (habitDone ? 1 : 0)
    return total > 0 ? Math.round((done / total) * 100) : 0
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
    const adherence = calcAdherence(newSet, habitDoneToday, tasks.length)

    // Streak is credited once per period when the leader rolls the period over,
    // not here — incrementing on each toggle meant unchecking and rechecking an
    // item inflated it every time.
    await supabase.from('profiles').update({ adherence_percent: adherence }).eq('id', userId)
  }

  async function toggleHabit() {
    const supabase = createClient()
    const newHabitDone = !habitDoneToday

    if (habitDoneToday) {
      await supabase.from('habit_completions').delete().eq('user_id', userId).eq('completed_date', today)
      const reverted = Math.max(0, habitStreak - 1)
      setHabitStreak(reverted)
      setHabitStreakAtRisk(reverted > 0)
    } else {
      await supabase.from('habit_completions').insert({ user_id: userId, completed_date: today })
      setHabitStreak(habitStreak + 1)
      setHabitStreakAtRisk(false)
      setHabitJustDone(true)
      setTimeout(() => setHabitJustDone(false), 3000)
    }

    setHabitDoneToday(newHabitDone)
    const adherence = calcAdherence(completedIds, newHabitDone, tasks.length)
    await supabase.from('profiles').update({ adherence_percent: adherence }).eq('id', userId)
  }

  const adherence = calcAdherence(completedIds, habitDoneToday, tasks.length)
  const allDone = tasks.length > 0 && completedIds.size === tasks.length && habitDoneToday

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
            {/* Daily Habit Section */}
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Daily Habit</p>
                {habitStreak > 0 && (
                  <p className={`text-xs font-semibold ${habitStreakAtRisk ? 'text-gray-400' : 'text-orange-500'}`}>
                    🔥 {habitStreak} day{habitStreak !== 1 ? 's' : ''}
                    {habitStreakAtRisk && ' — check in to keep it'}
                  </p>
                )}
              </div>
              {habitJustDone && (
                <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-4 text-center mb-3">
                  <p className="text-3xl mb-1">🔥</p>
                  <p className="font-bold text-orange-700">{habitStreak > 1 ? `${habitStreak} days in a row!` : 'Habit done!'}</p>
                  <p className="text-orange-500 text-xs mt-0.5">Keep the streak alive tomorrow</p>
                </div>
              )}
              {currentHabit ? (
                <button onClick={toggleHabit}
                  className={`w-full bg-white rounded-2xl p-4 shadow-sm flex items-start gap-4 text-left transition-opacity ${habitDoneToday ? 'opacity-60' : ''}`}>
                  <div className={`mt-0.5 w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    habitDoneToday ? 'bg-bt-navy border-bt-navy' : 'border-gray-300'
                  }`}>
                    {habitDoneToday && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`font-semibold text-gray-900 ${habitDoneToday ? 'line-through text-gray-400' : ''}`}>
                      {currentHabit}
                    </p>
                    <p className="text-gray-400 text-xs mt-0.5">Daily check-in</p>
                  </div>
                </button>
              ) : (
                <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
                  <p className="text-gray-400 text-sm">No habit set yet</p>
                  <a href="/profile" className="text-bt-blue text-sm font-semibold mt-1 block">Set your habit →</a>
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
