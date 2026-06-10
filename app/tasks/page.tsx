'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const [periodLabel, setPeriodLabel] = useState('Current')
  const router = useRouter()

  useEffect(() => { loadTasks() }, [])

  async function loadTasks() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    setUserId(user.id)

    const { data: prof } = await supabase.from('profiles').select('group_id').eq('id', user.id).single()
    if (!prof?.group_id) { setLoading(false); return }

    const [{ data: taskData }, { data: completions }] = await Promise.all([
      supabase.from('tasks').select('*').eq('group_id', prof.group_id).eq('archived', false).order('created_at', { ascending: false }),
      supabase.from('task_completions').select('task_id').eq('user_id', user.id)
    ])

    setTasks(taskData || [])
    if (taskData && taskData.length > 0) setPeriodLabel(taskData[0].period_label || 'Current')
    setCompletedIds(new Set(completions?.map((c: any) => c.task_id)))
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
    const adherence = tasks.length > 0 ? Math.round((newSet.size / tasks.length) * 100) : 0
    await supabase.from('profiles').update({ adherence_percent: adherence }).eq('id', userId)
  }

  const adherence = tasks.length > 0 ? Math.round((completedIds.size / tasks.length) * 100) : 0
  const allDone = tasks.length > 0 && completedIds.size === tasks.length

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">My Tasks</h1>
        <p className="text-bt-light/70 text-sm mt-0.5">{periodLabel} period</p>
        <div className="flex items-center gap-3 mt-4">
          <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-bt-light rounded-full transition-all duration-500" style={{ width: `${adherence}%` }} />
          </div>
          <span className="text-white text-sm font-bold w-10 text-right">{adherence}%</span>
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-3">
        {allDone && (
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 text-center">
            <p className="text-4xl mb-2">🎉</p>
            <p className="font-bold text-green-700 text-lg">You crushed it!</p>
            <p className="text-green-600 text-sm mt-1">100% this period. Your table sees it. Keep it up.</p>
          </div>
        )}
        {loading && <p className="text-center text-gray-400 py-10">Loading...</p>}
        {!loading && tasks.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📋</p>
            <p className="text-gray-500 font-medium">No tasks this period</p>
            <p className="text-gray-400 text-sm mt-1">Your leader will post tasks here</p>
          </div>
        )}
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

      <BottomNav />
    </div>
  )
}
