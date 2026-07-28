'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function DirectoryPage() {
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [startingDM, setStartingDM] = useState('')
  const [dmError, setDmError] = useState('')
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
    if (startingDM) return
    setStartingDM(memberId)
    setDmError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setStartingDM(''); return }

    // Ensure consistent ordering for unique constraint
    const [p1, p2] = [user.id, memberId].sort()

    const { data: existing } = await supabase
      .from('dm_conversations')
      .select('id')
      .eq('participant_1', p1)
      .eq('participant_2', p2)
      .maybeSingle()

    if (existing) {
      router.push(`/dm/${existing.id}`)
      return
    }

    const { data: newConvo, error } = await supabase
      .from('dm_conversations')
      .insert({ participant_1: p1, participant_2: p2 })
      .select()
      .single()

    if (newConvo) {
      router.push(`/dm/${newConvo.id}`)
      return
    }

    // Two people tapping Message on each other at once both miss the lookup
    // above and both insert; the loser hits the unique constraint, so retry the
    // read rather than telling them it failed.
    if (error?.code === '23505') {
      const { data: raced } = await supabase
        .from('dm_conversations').select('id')
        .eq('participant_1', p1).eq('participant_2', p2).maybeSingle()
      if (raced) { router.push(`/dm/${raced.id}`); return }
    }

    // Previously this returned silently, so the button did nothing at all.
    console.error('dm_conversations insert failed:', error?.message)
    setDmError("Couldn't start that conversation. Please try again.")
    setStartingDM('')
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
        {/* members excludes the viewer, so "N opted in" always read one higher
            than the number of cards below it. */}
        <p className="text-bt-light/60 text-sm mt-0.5">
          {members.length} other {members.length === 1 ? 'member' : 'members'} opted in
        </p>
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
        {dmError && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-3 text-center">
            <p className="text-red-700 text-sm font-medium">{dmError}</p>
          </div>
        )}
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
                    disabled={!!startingDM}
                    className="text-xs bg-bt-navy text-white px-3 py-1.5 rounded-full font-medium disabled:opacity-50">
                    {startingDM === member.id ? 'Opening…' : '💬 Message'}
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
