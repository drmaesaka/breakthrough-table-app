'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function GroupPage() {
  const [members, setMembers] = useState<any[]>([])
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState('')
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setCurrentUserId(user.id)

      const { data: prof } = await supabase
        .from('profiles')
        .select('group_id, groups(name)')
        .eq('id', user.id)
        .single()

      if (!prof?.group_id) { router.push('/dashboard'); return }
      setGroupName((prof.groups as any)?.name || 'My Group')

      const { data: memberData } = await supabase
        .from('profiles')
        .select('id, full_name, adherence_percent, role')
        .eq('group_id', prof.group_id)
        .order('adherence_percent', { ascending: false })

      setMembers(memberData || [])
      setLoading(false)
    }
    load()
  }, [router])

  const avg = members.length > 0
    ? Math.round(members.reduce((s, m) => s + (m.adherence_percent || 0), 0) / members.length) : 0

  function initials(name: string) {
    return name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  }

  function medal(index: number, pct: number) {
    if (pct === 0) return ''
    if (index === 0) return '🥇'
    if (index === 1) return '🥈'
    if (index === 2) return '🥉'
    return ''
  }

  function barColor(pct: number) {
    if (pct === 100) return '#22c55e'
    if (pct >= 75) return '#5B9BD5'
    if (pct > 0) return '#f59e0b'
    return '#e5e7eb'
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">{groupName}</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">Group progress this period</p>
        <div className="mt-4 bg-white/10 rounded-2xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-bt-light/70 text-xs font-medium">Group Average</p>
            <p className="text-white text-2xl font-bold mt-0.5">{avg}%</p>
          </div>
          <div className="text-right">
            <p className="text-bt-light/70 text-xs font-medium">Members</p>
            <p className="text-white text-2xl font-bold mt-0.5">{members.length}</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-3">
        {members.map((member, i) => {
          const pct = member.adherence_percent || 0
          const isYou = member.id === currentUserId
          return (
            <div key={member.id}
              className={`bg-white rounded-2xl px-4 py-4 shadow-sm ${isYou ? 'ring-2 ring-bt-blue' : ''}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isYou ? 'bg-bt-blue' : 'bg-bt-pale'}`}>
                  <span className={`font-bold text-sm ${isYou ? 'text-white' : 'text-bt-navy'}`}>
                    {initials(member.full_name)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-semibold text-gray-900 text-sm">
                      {member.full_name}{isYou ? ' (you)' : ''}
                    </p>
                    {medal(i, pct) && <span>{medal(i, pct)}</span>}
                    {member.role === 'leader' && (
                      <span className="text-xs bg-bt-navy text-white px-2 py-0.5 rounded-full">Leader</span>
                    )}
                  </div>
                  <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: barColor(pct) }} />
                  </div>
                </div>
                <span className={`flex-shrink-0 text-lg font-bold ${
                  pct === 100 ? 'text-green-500' : pct >= 75 ? 'text-bt-blue' : 'text-gray-400'
                }`}>{pct}%</span>
              </div>
            </div>
          )
        })}

        {members.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">No members in this group yet.</p>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
