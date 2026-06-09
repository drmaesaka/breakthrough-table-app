'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function GroupPage() {
  const [group, setGroup] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [completions, setCompletions] = useState<any[]>([])
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
        const { data: group } = await supabase
          .from('groups')
          .select('*')
          .eq('id', profile.group_id)
          .single()
        setGroup(group)

        const { data: members } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('group_id', profile.group_id)
        setMembers(members || [])

        const { data: tasks } = await supabase
          .from('tasks')
          .select('*')
          .eq('group_id', profile.group_id)
        setTasks(tasks || [])

        const { data: completions } = await supabase
          .from('task_completions')
          .select('user_id, task_id')
        setCompletions(completions || [])
      }
      setLoading(false)
    }
    load()
  }, [])

  function getAdherence(userId: string) {
    if (tasks.length === 0) return 0
    const completed = completions.filter(c => c.user_id === userId).length
    return Math.round((completed / tasks.length) * 100)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Breakthrough Table</h1>
        <a href="/dashboard" className="text-sm text-blue-600 hover:underline">← Dashboard</a>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-semibold text-gray-800 mb-2">My Group</h2>
        {group && <p className="text-gray-500 mb-8">{group.name}</p>}

        {members.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center text-gray-500">
            You haven't been assigned to a group yet.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {members.map(member => {
              const adherence = getAdherence(member.id)
              return (
                <div key={member.id} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold text-gray-800">{member.full_name || 'Member'}</p>
                      <p className="text-xs text-gray-400 capitalize">{member.role}</p>
                    </div>
                    <span className="text-lg font-bold text-blue-600">{adherence}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${adherence}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}