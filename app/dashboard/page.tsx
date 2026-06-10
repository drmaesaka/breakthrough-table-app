'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function DashboardPage() {
  const [profile, setProfile] = useState<any>(null)
  const [groupName, setGroupName] = useState('')
  const [taskStats, setTaskStats] = useState({ total: 0, completed: 0 })
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase.from('profiles').select('*, groups(name)').eq('id', user.id).single()
      if (prof) {
        setProfile(prof)
        setGroupName(prof.groups?.name || '')
      }

      if (prof?.group_id) {
        const { data: tasks } = await supabase.from('tasks').select('id').eq('group_id', prof.group_id)
        const { data: completions } = await supabase.from('task_completions').select('task_id').eq('user_id', user.id)
        if (tasks) {
          const completedIds = new Set(completions?.map((c: any) => c.task_id))
          setTaskStats({ total: tasks.length, completed: tasks.filter((t: any) => completedIds.has(t.id)).length })
        }
      }
    }
    load()
  }, [router])

  const firstName = profile?.full_name?.split(' ')[0] || 'there'
  const adherence = taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-bt-light text-sm font-medium">Welcome back,</p>
            <h1 className="text-white text-3xl font-bold mt-0.5">{firstName} 👋</h1>
            {groupName && <p className="text-bt-light/70 text-sm mt-1">{groupName}</p>}
          </div>
          <button onClick={handleLogout}
            className="mt-1 text-bt-light/60 hover:text-white text-xs font-medium px-3 py-1.5 rounded-lg border border-white/20 transition-colors">
            Sign out
          </button>
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">
        {/* Adherence card */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-gray-400 text-sm font-medium">Your Adherence This Period</p>
          <div className="flex items-end gap-2 mt-2 mb-3">
            <span className="text-5xl font-bold text-bt-navy">{adherence}%</span>
            <span className="text-gray-400 text-sm pb-1.5">{taskStats.completed} of {taskStats.total} tasks</span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-bt-blue rounded-full transition-all duration-500" style={{ width: `${adherence}%` }} />
          </div>
        </div>

        {/* Nav cards */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { href: '/tasks', emoji: '✅', title: 'My Tasks', sub: 'Track & complete' },
            { href: '/messages', emoji: '💬', title: 'Group Chat', sub: 'Talk to your table' },
            { href: '/content', emoji: '📚', title: 'Library', sub: 'Resources & videos' },
            { href: '/group', emoji: '👥', title: 'My Group', sub: 'See group progress' },
          ].map(card => (
            <Link key={card.href} href={card.href}
              className="bg-white rounded-2xl p-4 shadow-sm active:scale-95 transition-transform block">
              <div className="text-3xl mb-2">{card.emoji}</div>
              <p className="font-semibold text-bt-navy text-sm">{card.title}</p>
              <p className="text-gray-400 text-xs mt-0.5">{card.sub}</p>
            </Link>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}