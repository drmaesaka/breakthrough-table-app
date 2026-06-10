'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function AnalyticsPage() {
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (prof?.role !== 'leader') { router.push('/dashboard'); return }

      const { data: groupsData } = await supabase
        .from('groups')
        .select('id, name')
        .eq('leader_id', user.id)

      if (!groupsData) { setLoading(false); return }

      const enriched = await Promise.all(groupsData.map(async (g) => {
        const { data: members } = await supabase
          .from('profiles')
          .select('id, full_name, adherence_percent, streak, role')
          .eq('group_id', g.id)
          .order('adherence_percent', { ascending: false })

        const m = members || []
        const avg = m.length > 0
          ? Math.round(m.reduce((s, p) => s + (p.adherence_percent || 0), 0) / m.length)
          : 0
        const at100 = m.filter(p => p.adherence_percent === 100).length
        const topStreak = Math.max(...m.map(p => p.streak || 0), 0)

        return { ...g, members: m, avg, at100, topStreak }
      }))

      setGroups(enriched)
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
    return name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
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
        <p className="text-bt-light/60 text-sm mt-0.5">All groups overview</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-5">
        {groups.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📊</p>
            <p className="text-gray-500 font-medium">No groups yet</p>
            <p className="text-gray-400 text-sm mt-1">Create a group in the Admin panel</p>
          </div>
        )}

        {groups.map(group => (
          <div key={group.id} className="space-y-3">
            {/* Group header card */}
            <div className="bg-bt-navy rounded-2xl p-4">
              <h2 className="text-white font-bold text-lg">{group.name}</h2>
              <div className="flex gap-4 mt-3">
                <div className="flex-1 text-center">
                  <p className="text-white text-xl font-bold">{group.avg}%</p>
                  <p className="text-bt-light/60 text-xs mt-0.5">Avg adherence</p>
                </div>
                <div className="flex-1 text-center">
                  <p className="text-white text-xl font-bold">{group.at100}</p>
                  <p className="text-bt-light/60 text-xs mt-0.5">At 100%</p>
                </div>
                <div className="flex-1 text-center">
                  <p className="text-white text-xl font-bold">{group.members.length}</p>
                  <p className="text-bt-light/60 text-xs mt-0.5">Members</p>
                </div>
                {group.topStreak > 0 && (
                  <div className="flex-1 text-center">
                    <p className="text-white text-xl font-bold">{group.topStreak}🔥</p>
                    <p className="text-bt-light/60 text-xs mt-0.5">Top streak</p>
                  </div>
                )}
              </div>
            </div>

            {/* Member rows */}
            {group.members.map((member: any, i: number) => {
              const pct = member.adherence_percent || 0
              return (
                <div key={member.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-bt-pale flex items-center justify-center flex-shrink-0">
                      <span className="text-bt-navy font-bold text-xs">{initials(member.full_name)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 text-sm truncate">{member.full_name}</p>
                        {member.streak > 0 && (
                          <span className="text-xs text-orange-500 font-semibold">{member.streak}🔥</span>
                        )}
                        {member.role === 'leader' && (
                          <span className="text-xs bg-bt-navy text-white px-1.5 py-0.5 rounded-full">L</span>
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

            {group.members.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-4 bg-white rounded-2xl">No members yet — share your invite link!</p>
            )}
          </div>
        ))}
      </div>
      <BottomNav />
    </div>
  )
}
