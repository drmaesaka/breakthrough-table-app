'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function DirectoryPage() {
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [myId, setMyId] = useState('')
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setMyId(user.id)

      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, bio, linkedin_url, contact_email, group_id, groups(name)')
        .eq('directory_opt_in', true)
        .order('full_name', { ascending: true })

      setMembers(data || [])
      setLoading(false)
    }
    load()
  }, [router])

  async function startDM(memberId: string) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Ensure consistent ordering for unique constraint
    const [p1, p2] = [user.id, memberId].sort()

    const { data: existing } = await supabase
      .from('dm_conversations')
      .select('id')
      .eq('participant_1', p1)
      .eq('participant_2', p2)
      .single()

    if (existing) {
      router.push(`/dm/${existing.id}`)
      return
    }

    const { data: newConvo } = await supabase
      .from('dm_conversations')
      .insert({ participant_1: p1, participant_2: p2 })
      .select()
      .single()

    if (newConvo) router.push(`/dm/${newConvo.id}`)
  }

  function getInitials(name: string) {
    const parts = (name || '').trim().split(' ')
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase() || '?'
  }

  const filtered = members.filter(m =>
    m.id !== myId &&
    (m.full_name?.toLowerCase().includes(search.toLowerCase()) ||
     m.bio?.toLowerCase().includes(search.toLowerCase()))
  )

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-5">
        <h1 className="text-white text-2xl font-bold">Member Directory</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">{members.length} members opted in</p>
        <div className="mt-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or what they do..."
            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-white/50 text-sm"
          />
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-3">
        {filtered.length === 0 && !loading && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">👥</p>
            <p className="text-gray-500 font-medium">
              {members.length === 0 ? 'No members in the directory yet' : 'No results'}
            </p>
            <p className="text-gray-400 text-sm mt-1">
              {members.length === 0 ? 'Members can opt in from their profile' : 'Try a different search'}
            </p>
          </div>
        )}

        {filtered.map(member => (
          <div key={member.id} className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-full bg-bt-navy flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-sm">{getInitials(member.full_name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900">{member.full_name}</p>
                {(member.groups as any)?.name && (
                  <p className="text-xs text-bt-blue font-medium mt-0.5">{(member.groups as any).name}</p>
                )}
                {member.bio && (
                  <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{member.bio}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {member.contact_email && (
                    <a href={`mailto:${member.contact_email}`}
                      className="text-xs bg-bt-pale text-bt-navy px-3 py-1.5 rounded-full font-medium">
                      ✉️ Email
                    </a>
                  )}
                  {member.linkedin_url && (
                    <a href={member.linkedin_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs bg-bt-pale text-bt-navy px-3 py-1.5 rounded-full font-medium">
                      💼 LinkedIn
                    </a>
                  )}
                  <button
                    onClick={() => startDM(member.id)}
                    className="text-xs bg-bt-navy text-white px-3 py-1.5 rounded-full font-medium">
                    💬 Message
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <BottomNav />
    </div>
  )
}
