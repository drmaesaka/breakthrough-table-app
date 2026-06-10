'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

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
  const router = useRouter()

  const today = new Date().toISOString().split('T')[0]

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
      supabase.from('task_completions').select('task_id').eq('user_id', user.id),
      supabase.from('habit_completions').select('id').eq('user_id', user.id).eq('completed_date', today).single(),
      supabase.from('habit_completions').select('completed_date').eq('user_id', user.id).order('completed_date', { ascending: false }).limit(60),
    ])

    setTasks(taskData || [])
    if (taskData && taskData.length > 0) setPeriodLabel(taskData[0].period_label || 'Current')
    setCompletedIds(new Set(completions?.map((c: any) => c.task_id)))
    setHabitDoneToday(!!habitToday)

    // Calculate habit streak (consecutive days ending today)
    if (habitHistory && habitHistory.length > 0) {
      const dates = habitHistory.map((h: any) => h.completed_date)
      let streak = 0
      const d = new Date()
      while (true) {
        const dateStr = d.toISOString().split('T')[0]
        if (dates.includes(dateStr)) {
          streak++
          d.setDate(d.getDate() - 1)
        } else break
      }
      setHabitStreak(streak)
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
    const allDone = newSet.size === tasks.length && habitDoneToday && tasks.length > 0
    const newStreak = allDone ? streak + 1 : streak

    await supabase.from('profiles').update({
      adherence_percent: adherence,
      ...(allDone ? { streak: newStreak } : {})
    }).eq('id', userId)

    if (allDone) setStreak(newStreak)
  }

  async function toggleHabit() {
    const supabase = createClient()
    const newHabitDone = !habitDoneToday

    if (habitDoneToday) {
      await supabase.from('habit_completions').delete().eq('user_id', userId).eq('completed_date', today)
      if (habitStreak > 0) setHabitStreak(habitStreak - 1)
    } else {
      await supabase.from('habit_completions').insert({ user_id: userId, completed_date: today })
      setHabitStreak(habitStreak + 1)
    }

    setHabitDoneToday(newHabitDone)
    const adherence = calcAdherence(completedIds, newHabitDone, tasks.length)
    const allDone = completedIds.size === tasks.length && newHabitDone && tasks.length > 0
    const newStreak = allDone ? streak + 1 : streak

    await supabase.from('profiles').update({
      adherence_percent: adherence,
      ...(allDone ? { streak: newStreak } : {})
    }).eq('id', userId)

    if (allDone) setStreak(newStreak)
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
              <p className="text-white text-sm font-bold">{streak} streak</p>
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
                  <p className="text-xs text-orange-500 font-semibold">🔥 {habitStreak} day{habitStreak !== 1 ? 's' : ''}</p>
                )}
              </div>
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
