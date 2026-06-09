'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [completedIds, setCompletedIds] = useState<string[]>([])
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      const { data: profile } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single()

      if (profile?.group_id) {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('*')
          .eq('group_id', profile.group_id)
          .order('created_at', { ascending: false })
        setTasks(tasks || [])

        const { data: completions } = await supabase
          .from('task_completions')
          .select('task_id')
          .eq('user_id', user.id)
        setCompletedIds(completions?.map((c: any) => c.task_id) || [])
      }
      setLoading(false)
    }
    load()
  }, [])

  async function completeTask(taskId: string) {
    if (!user) return
    await supabase.from('task_completions').insert({ task_id: taskId, user_id: user.id })
    setCompletedIds(prev => [...prev, taskId])
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Breakthrough Table</h1>
        <a href="/dashboard" className="text-sm text-blue-600 hover:underline">← Dashboard</a>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-semibold text-gray-800 mb-8">My Tasks</h2>

        {tasks.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center text-gray-500">
            No tasks assigned yet. Check back after your next meeting.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {tasks.map(task => {
              const completed = completedIds.includes(task.id)
              return (
                <div key={task.id} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">{task.title}</h3>
                    {task.description && <p className="text-sm text-gray-500 mt-1">{task.description}</p>}
                    {task.due_date && <p className="text-xs text-gray-400 mt-2">Due: {new Date(task.due_date).toLocaleDateString()}</p>}
                  </div>
                  <button
                    onClick={() => !completed && completeTask(task.id)}
                    className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition ${
                      completed
                        ? 'bg-green-100 text-green-700 cursor-default'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {completed ? '✓ Done' : 'Mark Complete'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}