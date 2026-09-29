'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import Link from 'next/link'
import Avatar from '@/components/Avatar'

type Detail = {
  id: string; full_name: string; avatar_url: string | null; role: string
  adherence_percent: number; streak: number; email: string | null; joined: string
  habits: { id: string; name: string; frequency: 'daily' | 'weekly' | 'monthly'; done: boolean; streak: number; last_check_in: string | null }[]
  tasks_done: number; meetings_attended: number; last_meeting: string | null
  prompts_answered: number; push_enabled: boolean
}

// My Table. Members see the table's progress. A TC sees the same list with
// every member expandable into their habits, reading, attendance, prompts
// and whether notifications reach them (leader feedback 2026-09-29), and a
// picker if they lead more than one table.
export default function GroupPage() {
  const [members, setMembers] = useState<any[]>([])
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState('')
  const [isLeader, setIsLeader] = useState(false)
  const [tables, setTables] = useState<{ id: string; name: string }[]>([])
  const [groupId, setGroupId] = useState<string | null>(null)
  const [homeGroupId, setHomeGroupId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ members: Detail[]; tasks_total: number; prompts_total: number } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const router = useRouter()

  async function headers(): Promise<Record<string, string>> {
    const { data: { session } } = await createClient().auth.getSession()
    return { Authorization: `Bearer ${session?.access_token ?? ''}` }
  }

  async function loadTable(gid: string, leader: boolean) {
    const supabase = createClient()
    const [{ data: g }, { data: memberData }] = await Promise.all([
      supabase.from('groups').select('name').eq('id', gid).maybeSingle(),
      supabase.from('profiles').select('id, full_name, adherence_percent, role, avatar_url').eq('group_id', gid).order('adherence_percent', { ascending: false }),
    ])
    if (g?.name) setGroupName(g.name)
    setMembers(memberData || [])
    if (leader) {
      const res = await fetch(`/api/admin/table-overview?group_id=${encodeURIComponent(gid)}`, { headers: await headers() })
      if (res.ok) {
        const json = await res.json()
        setDetail(json)
        // The browser read of profiles may be filtered for a table the TC does
        // not sit at; the server list is authoritative for leaders.
        if (json.members?.length) setMembers(json.members)
      }
    }
  }

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setCurrentUserId(user.id)

      const { data: prof } = await supabase
        .from('profiles').select('group_id, role, groups(name)').eq('id', user.id).single()
      const leader = prof?.role === 'leader'
      setIsLeader(leader)
      const home = prof?.group_id || null
      setHomeGroupId(home)
      if (home) setGroupName((prof?.groups as any)?.name || 'My Group')

      let all: { id: string; name: string }[] = home ? [{ id: home, name: (prof?.groups as any)?.name || 'My table' }] : []
      if (leader) {
        const res = await fetch('/api/admin/my-groups', { headers: await headers() }).catch(() => null)
        const led = res && res.ok ? ((await res.json()).groups || []) : []
        all = [...all, ...led.filter((g: any) => g.id !== home).map((g: any) => ({ id: g.id, name: g.name }))]
      }
      setTables(all)
      const first = all[0]?.id || null
      if (!first) { router.push('/dashboard'); return }
      setGroupId(first)
      await loadTable(first, leader)
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  async function switchTable(gid: string) {
    setGroupId(gid); setDetail(null); setOpen(null)
    const t = tables.find(x => x.id === gid); if (t) setGroupName(t.name)
    await loadTable(gid, isLeader)
  }

  const avg = members.length > 0
    ? Math.round(members.reduce((s, m) => s + (m.adherence_percent || 0), 0) / members.length) : 0

  function medal(index: number, pct: number) {
    if (pct === 0) return ''
    return index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : ''
  }
  function barColor(pct: number) {
    if (pct === 100) return '#22c55e'
    if (pct >= 75) return '#5B9BD5'
    if (pct > 0) return '#f59e0b'
    return '#e5e7eb'
  }
  function fmt(d: string | null) {
    if (!d) return '—'
    const [y, m, dd] = d.slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  const detailById = new Map((detail?.members || []).map(m => [m.id, m]))

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-white text-2xl font-bold truncate">{groupName}</h1>
            <p className="text-bt-light/60 text-sm mt-0.5">Group progress this period</p>
          </div>
          {isLeader && (
            <Link href="/analytics" className="flex-shrink-0 bg-white/15 text-white text-xs font-semibold px-3 py-2 rounded-xl mt-1">
              📊 Stats
            </Link>
          )}
        </div>
        {isLeader && tables.length > 1 && (
          <select value={groupId || ''} onChange={e => switchTable(e.target.value)}
            className="mt-3 w-full bg-white/15 text-white text-sm rounded-xl px-3 py-2 border border-white/25 focus:outline-none">
            {tables.map(t => <option key={t.id} value={t.id} className="text-gray-900">{t.name}{t.id === homeGroupId ? ' (your table)' : ''}</option>)}
          </select>
        )}
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
        {isLeader && detail && (
          <p className="text-bt-light/60 text-[11px] mt-2">TC view: tap a member for their habits, reading, attendance and more.</p>
        )}
      </div>

      <div className="px-5 py-5 pb-28 space-y-3">
        {members.map((member, i) => {
          const pct = member.adherence_percent || 0
          const isYou = member.id === currentUserId
          const d = detailById.get(member.id)
          const expanded = open === member.id
          return (
            <div key={member.id}
              className={`bg-white rounded-2xl px-4 py-4 shadow-sm ${isYou ? 'ring-2 ring-bt-blue' : ''}`}>
              <div className={`flex items-center gap-3 ${d ? 'cursor-pointer' : ''}`} onClick={() => d && setOpen(expanded ? null : member.id)}>
                <Avatar src={member.avatar_url} name={member.full_name}
                  className={`w-10 h-10 ${isYou ? 'bg-bt-blue' : 'bg-bt-pale'}`}
                  textClass={`font-bold text-sm ${isYou ? 'text-white' : 'text-bt-navy'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-semibold text-gray-900 text-sm">
                      {member.full_name}{isYou ? ' (you)' : ''}
                    </p>
                    {medal(i, pct) && <span>{medal(i, pct)}</span>}
                    {member.role === 'leader' && (
                      <span className="text-xs bg-bt-navy text-white px-2 py-0.5 rounded-full">Leader</span>
                    )}
                    {d && !d.push_enabled && <span className="text-xs" title="No notifications">🔕</span>}
                  </div>
                  <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: barColor(pct) }} />
                  </div>
                  {d && (
                    <p className="text-[11px] text-gray-400 mt-1.5">
                      {d.habits.filter(h => h.done).length}/{d.habits.length} habits · {d.tasks_done}/{detail?.tasks_total ?? 0} reading · {d.meetings_attended} mtg{d.meetings_attended === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
                <span className={`flex-shrink-0 text-lg font-bold ${
                  pct === 100 ? 'text-green-500' : pct >= 75 ? 'text-bt-blue' : 'text-gray-400'
                }`}>{pct}%</span>
              </div>

              {d && expanded && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-sm">
                  <div>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Habits</p>
                    {d.habits.length === 0 && <p className="text-xs text-gray-400">No habit set.</p>}
                    {d.habits.map(h => (
                      <div key={h.id} className="flex items-center justify-between py-1">
                        <span className={`text-sm ${h.done ? 'text-gray-800' : 'text-gray-500'}`}>{h.done ? '✓' : '○'} {h.name} <span className="text-[10px] text-gray-400 uppercase">{h.frequency}</span></span>
                        <span className="text-xs text-gray-400">{h.streak > 0 ? `🔥 ${h.streak}` : ''} {h.last_check_in ? `· last ${fmt(h.last_check_in)}` : '· never'}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-bt-pale rounded-xl p-3"><p className="text-gray-400">Reading &amp; Resources</p><p className="font-bold text-bt-navy text-base">{d.tasks_done} <span className="text-gray-400 font-normal">of {detail?.tasks_total ?? 0}</span></p></div>
                    <div className="bg-bt-pale rounded-xl p-3"><p className="text-gray-400">Meetings attended</p><p className="font-bold text-bt-navy text-base">{d.meetings_attended} <span className="text-gray-400 font-normal">last {fmt(d.last_meeting)}</span></p></div>
                    <div className="bg-bt-pale rounded-xl p-3"><p className="text-gray-400">Prompts answered</p><p className="font-bold text-bt-navy text-base">{d.prompts_answered} <span className="text-gray-400 font-normal">of {detail?.prompts_total ?? 0}</span></p></div>
                    <div className="bg-bt-pale rounded-xl p-3"><p className="text-gray-400">Notifications</p><p className={`font-bold text-base ${d.push_enabled ? 'text-green-600' : 'text-amber-600'}`}>{d.push_enabled ? 'On' : 'Off'}</p></div>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Period streak {d.streak} · joined {fmt(d.joined)}{d.email ? ` · ${d.email}` : ''}
                  </p>
                </div>
              )}
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
