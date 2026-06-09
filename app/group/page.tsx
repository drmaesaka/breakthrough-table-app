'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function GroupPage() {
  const [members, setMembers] = useState<any[]>([])
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('group_id').eq('id', user.id).single()
      if (!prof?.group_id) { setLoading(false); return }
      const { data: group } = await supabase.from('groups').select('name').eq('id', prof.group_id).single()
      setGroupName(group?.name || 'My Group')
      const { data: memberData } = await supabase
        .from('profiles').select('id, full_name, adherence_percent, role')
        .eq('group_id', prof.group_id).order('adherence_percent', { ascending: false })
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

  function barColor(pct: number) {
    if (pct >= 80) return 'bg-green-500'
    if (pct >= 50) return 'bg-bt-blue'
    return 'bg-orange-400'
  }

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">{groupName}</h1>
        <p className="text-bt-light/70 text-sm mt-0.5">Group average: {avg}% adherence</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-3">
        {loading && <p className="text-center text-gray-400 py-10">Loading...</p>}
        {members.map((member, i) => {
          const pct = member.adherence_percent || 0
          return (
            <div key={member.id} className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-full bg-bt-pale flex items-center justify-center flex-shrink-0">
                  <span className="text-bt-navy font-bold text-sm">{initials(member.full_name)}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900">{member.full_name}</p>
                    {member.role === 'leader' && (
                      <span className="text-xs bg-bt-navy text-white px-2 py-0.5 rounded-full">Leader</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400">{pct}% adherence</p>
                </div>
                <span className="text-xl font-bold text-bt-light">#{i + 1}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <BottomNav />
    </div>
  )
}