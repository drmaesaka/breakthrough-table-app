'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function AnalyticsPage() {
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const router = useRouter()

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (prof?.role !== 'leader') { router.push('/dashboard'); return }

      // Load ALL groups (leaders can see all tables)
      const { data: groupsData } = await supabase
        .from('groups')
        .select('id, name, leader_id')
        .order('name', { ascending: true })

      if (!groupsData) { setLoading(false); return }

      // Load all members, habit completions today, and tasks/completions in parallel
      const [{ data: allMembers }, { data: habitToday }, { data: allTasks }, { data: allTaskCompletions }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, adherence_percent, streak, role, group_id, current_habit').not('group_id', 'is', null),
        supabase.from('habit_completions').select('user_id').eq('completed_date', today),
        supabase.from('tasks').select('id, group_id').eq('archived', false),
        supabase.from('task_completions').select('user_id, task_id'),
      ])

      const habitDoneSet = new Set((habitToday || []).map((h: any) => h.user_id))

      const enriched = groupsData.map(g => {
        const members = (allMembers || [])
          .filter((m: any) => m.group_id === g.id)
          .sort((a: any, b: any) => (b.adherence_percent || 0) - (a.adherence_percent || 0))

        const groupTasks = (allTasks || []).filter((t: any) => t.group_id === g.id)

        const membersWithStats = members.map((m: any) => {
          const habitDone = habitDoneSet.has(m.id)
          const userCompletedTaskIds = new Set(
            (allTaskCompletions || []).filter((c: any) => c.user_id === m.id).map((c: any) => c.task_id)
          )
          const readingDone = groupTasks.length === 0 || groupTasks.every((t: any) => userCompletedTaskIds.has(t.id))
          return { ...m, habitDone, readingDone }
        })

        const avg = members.length > 0
          ? Math.round(members.reduce((s: number, p: any) => s + (p.adherence_percent || 0), 0) / members.length)
          : 0
        const at100 = members.filter((p: any) => (p.adherence_percent || 0) === 100).length
        const topStreak = Math.max(...members.map((p: any) => p.streak || 0), 0)
        const habitDoneCount = members.filter((m: any) => habitDoneSet.has(m.id)).length

        return { ...g, members: membersWithStats, avg, at100, topStreak, habitDoneCount }
      }).filter(g => g.members.length > 0) // hide empty groups

      setGroups(enriched)
      // Auto-expand first group
      if (enriched.length > 0) setExpandedGroup(enriched[0].id)
      setLoading(false)
    }
    load()
  }, [router])

  function getBarColor(pct: number) {
    if (pct === 100) return '#22c55e'
    if (pct >= 75) return '#5B9BD5'
    if (pct > 0) return '#f59e0b'
    return '#e5e7eb'
  }

  function initials(name: string) {
    const parts = (name || '').trim().split(' ')
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase() || '?'
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Analytics</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">{groups.length} active table{groups.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">
        {groups.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📊</p>
            <p className="text-gray-500 font-medium">No active groups yet</p>
            <p className="text-gray-400 text-sm mt-1">Create a group and add members in the Admin panel</p>
          </div>
        )}

        {groups.map(group => {
          const isExpanded = expandedGroup === group.id
          return (
            <div key={group.id} className="space-y-2">
              {/* Group summary card — tap to expand/collapse */}
              <button
                onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                className="w-full bg-bt-navy rounded-2xl p-4 text-left">
                <div className="flex items-center justify-between">
                  <h2 className="text-white font-bold text-base">{group.name}</h2>
                  <svg className={`w-4 h-4 text-white/50 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <div className="text-center">
                    <p className="text-white text-lg font-bold">{group.avg}%</p>
                    <p className="text-bt-light/50 text-xs">Avg</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white text-lg font-bold">{group.at100}</p>
                    <p className="text-bt-light/50 text-xs">At 100%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white text-lg font-bold">{group.habitDoneCount}/{group.members.length}</p>
                    <p className="text-bt-light/50 text-xs">Habit today</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white text-lg font-bold">{group.topStreak > 0 ? `${group.topStreak}🔥` : '—'}</p>
                    <p className="text-bt-light/50 text-xs">Top streak</p>
                  </div>
                </div>

                {/* Group progress bar */}
                <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div className="h-full bg-bt-light rounded-full transition-all duration-500"
                    style={{ width: `${group.avg}%` }} />
                </div>
              </button>

              {/* Member rows */}
              {isExpanded && (
                <div className="space-y-2">
                  {group.members.length === 0 && (
                    <p className="text-center text-gray-400 text-sm py-4 bg-white rounded-2xl">No members yet</p>
                  )}
                  {group.members.map((member: any, i: number) => {
                    const pct = member.adherence_percent || 0
                    return (
                      <div key={member.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-3">
                          {/* Rank */}
                          <div className="w-6 text-center flex-shrink-0">
                            {i === 0 ? <span className="text-base">🥇</span>
                              : i === 1 ? <span className="text-base">🥈</span>
                              : i === 2 ? <span className="text-base">🥉</span>
                              : <span className="text-xs text-gray-300 font-bold">#{i + 1}</span>}
                          </div>

                          {/* Avatar */}
                          <div className="w-8 h-8 rounded-full bg-bt-pale flex items-center justify-center flex-shrink-0">
                            <span className="text-bt-navy font-bold text-xs">{initials(member.full_name)}</span>
                          </div>

                          {/* Name + habit status */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-medium text-gray-900 text-sm truncate">{member.full_name}</p>
                              {member.role === 'leader' && (
                                <span className="text-xs bg-bt-navy text-white px-1.5 py-0.5 rounded-full">L</span>
                              )}
                              {member.streak > 0 && (
                                <span className="text-xs text-orange-500 font-semibold">{member.streak}🔥</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-xs font-medium ${member.habitDone ? 'text-green-500' : 'text-gray-300'}`}>
                                {member.habitDone ? '✓ habit' : '○ habit'}
                              </span>
                              <span className="text-gray-200">·</span>
                              <span className={`text-xs font-medium ${member.readingDone ? 'text-green-500' : 'text-gray-300'}`}>
                                {member.readingDone ? '✓ reading' : '○ reading'}
                              </span>
                              {member.current_habit && (
                                <>
                                  <span className="text-gray-200">·</span>
                                  <span className="text-xs text-gray-400 truncate italic">{member.current_habit}</span>
                                </>
                              )}
                            </div>
                            <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: getBarColor(pct) }} />
                            </div>
                          </div>

                          <span className={`flex-shrink-0 text-sm font-bold w-10 text-right ${
                            pct === 100 ? 'text-green-500' : pct >= 75 ? 'text-bt-blue' : 'text-gray-400'
                          }`}>{pct}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <BottomNav />
    </div>
  )
}
