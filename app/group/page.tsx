'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import Link from 'next/link'
import Avatar from '@/components/Avatar'
import MyTasks from '@/components/MyTasks'
import TableChat from '@/components/TableChat'
import FollowUps from '@/components/FollowUps'
import { pickTable, setCurrentTable, onCurrentTableChange, getCurrentTable, ALL_TABLES } from '@/lib/current-table'
import { fetchMyTable } from '@/lib/my-table'

type Detail = {
  id: string; full_name: string; avatar_url: string | null; role: string
  adherence_percent: number; streak: number; email: string | null; joined: string
  habits: { id: string; name: string; frequency: 'daily' | 'weekly' | 'monthly'; done: boolean; streak: number; last_check_in: string | null }[]
  tasks_done: number; meetings_attended: number; last_meeting: string | null
  prompts_answered: number; push_enabled: boolean
}

// My Table, the table's home page, in three tabs: Chat (table chat, moved
// here from the Chat tab 2026-10-07), You (your habits and reading — the old
// Tasks tab, merged in 2026-10-05) and People (who is there). No percentages or medals for
// members: nothing here should look finished. A TC also gets the send card,
// every member expandable into their habits, reading, attendance
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
  const [view, setView] = useState<'chat' | 'you' | 'people' | 'followups'>('you')
  // TC quick-send: a message to the selected table, and a personal nudge
  // to one member — without a trip to Admin. (A 📚 Reading button sat here
  // until 2026-10-09; reading now goes in a message, or the + on the You tab.)
  const [sendMode, setSendMode] = useState<'message' | null>(null)
  const [sendText, setSendText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendNote, setSendNote] = useState('')
  const [nudgeText, setNudgeText] = useState('')
  const [nudging, setNudging] = useState(false)
  const [nudgeNote, setNudgeNote] = useState<{ id: string; text: string } | null>(null)
  // TC "Add a member" card (2026-10-09): the invite link for someone new, or
  // seat someone already in the app — what Admin → Tables does, from here.
  const [addOpen, setAddOpen] = useState(false)
  const [invite, setInvite] = useState<string | null>(null)
  const [inviteNote, setInviteNote] = useState('')
  const [candidates, setCandidates] = useState<{ id: string; full_name: string | null; group_id: string | null }[]>([])
  const [addPick, setAddPick] = useState('')
  const [adding, setAdding] = useState(false)
  const [addNote, setAddNote] = useState('')
  const router = useRouter()

  async function headers(): Promise<Record<string, string>> {
    const { data: { session } } = await createClient().auth.getSession()
    return { Authorization: `Bearer ${session?.access_token ?? ''}` }
  }

  async function loadTable(gid: string, leader: boolean) {
    const supabase = createClient()
    const [{ data: g }, { data: memberData }] = await Promise.all([
      supabase.from('groups').select('name').eq('id', gid).maybeSingle(),
      supabase.from('profiles').select('id, full_name, adherence_percent, streak, role, avatar_url').eq('group_id', gid).order('full_name', { ascending: true }),
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
      // Links can open a tab directly: /group?tab=you from a habit nudge.
      const want = new URLSearchParams(window.location.search).get('tab')

      const { data: prof } = await supabase
        .from('profiles').select('group_id, role, groups(name)').eq('id', user.id).single()
      const leader = prof?.role === 'leader'
      if (want === 'you' || want === 'chat' || want === 'followups' || (want === 'people' && prof?.role === 'leader')) setView(want)
      setIsLeader(leader)
      const home = prof?.group_id || null
      setHomeGroupId(home)
      if (home) setGroupName((prof?.groups as any)?.name || 'My Group')
      // The browser's groups read can come back empty for a member; ask the server then.
      const homeName = (prof?.groups as any)?.name || (home ? (await fetchMyTable())?.name : null)
      if (home && homeName) setGroupName(homeName)

      let all: { id: string; name: string }[] = home ? [{ id: home, name: homeName || 'My table' }] : []
      if (leader) {
        const res = await fetch('/api/admin/my-groups', { headers: await headers() }).catch(() => null)
        const led = res && res.ok ? ((await res.json()).groups || []) : []
        all = [...all, ...led.filter((g: any) => g.id !== home).map((g: any) => ({ id: g.id, name: g.name }))]
      }
      setTables(all)
      // ?table=<id> from a chat notification opens that table, if it is one of mine.
      const wantTable = new URLSearchParams(window.location.search).get('table')
      if (wantTable && !want) setView('chat')
      // Otherwise the table chosen in the "Working in" bar, else their own.
      // ?tab=you means your own habits, which live on your own table.
      const first = (wantTable && all.find(t => t.id === wantTable)?.id) || (want === 'you' && home) || pickTable(all.map(t => t.id), home)
      // Leave Admin's "All tables" choice alone; this screen just shows one table.
      if (first && leader && getCurrentTable() !== ALL_TABLES) setCurrentTable(first)
      if (!first) { router.push('/dashboard'); return }
      setGroupId(first)
      const firstName = all.find(t => t.id === first)?.name
      if (firstName) setGroupName(firstName)
      if (first !== home) setView(v => v === 'you' ? 'chat' : v)
      await loadTable(first, leader)
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  async function sendToTable() {
    const text = sendText.trim()
    if (!text || !groupId || !sendMode) return
    if (!confirm(`Send this to everyone at ${groupName}?`)) return
    setSending(true); setSendNote('')
    const h = { ...(await headers()), 'Content-Type': 'application/json' }
    try {
      const res = await fetch('/api/send-broadcast', { method: 'POST', headers: h,
        body: JSON.stringify({ group_id: groupId, message: text, scope: 'table' }) })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) { setSendNote(`Could not send: ${r.error || res.status}`); return }
      const parts = [`${r.sent} by push`]
      if (r.emailed) parts.push(`${r.emailed} by email`)
      setSendNote(`✓ Sent to ${r.recipients} member${r.recipients === 1 ? '' : 's'} (${parts.join(', ')}).`)
      setSendText(''); setSendMode(null)
    } finally {
      setSending(false)
    }
  }

  async function openAddMember() {
    if (addOpen) { setAddOpen(false); return }
    setAddOpen(true); setAddNote(''); setInviteNote(''); setAddPick(''); setInvite(null)
    const h = await headers()
    const [inv, mem] = await Promise.all([
      fetch(`/api/admin/invite?group_id=${encodeURIComponent(groupId!)}`, { headers: h }).catch(() => null),
      fetch('/api/admin/members', { headers: h }).catch(() => null),
    ])
    // A table the TC sits at but does not run has no invite for them.
    if (inv?.ok) setInvite((await inv.json()).url || null)
    else setInviteNote('Only this table’s TC can share its invite link.')
    const list = mem?.ok ? ((await mem.json()).members || []) : []
    setCandidates(list.filter((u: any) => u.group_id !== groupId)
      .sort((a: any, b: any) => (a.group_id ? 1 : 0) - (b.group_id ? 1 : 0) || (a.full_name || '').localeCompare(b.full_name || '')))
  }

  async function shareInvite() {
    if (!invite) return
    const text = `Join ${groupName} on the Breakthrough Table app: ${invite}`
    try {
      if (navigator.share) { await navigator.share({ title: 'Breakthrough Table', text, url: invite }); return }
    } catch { return /* closed the share sheet */ }
    try { await navigator.clipboard.writeText(invite); setInviteNote('✓ Link copied. Paste it in a text or email.') }
    catch { setInviteNote('Copy the link above and send it to them.') }
  }

  async function seatMember() {
    const who = candidates.find(c => c.id === addPick)
    if (!who || !groupId) return
    const from = who.group_id ? tables.find(t => t.id === who.group_id)?.name : null
    if (from && !confirm(`Move ${who.full_name || 'them'} from ${from} to ${groupName}? A person sits at one table.`)) return
    setAdding(true); setAddNote('')
    const res = await fetch('/api/admin/members', { method: 'PATCH',
      headers: { ...(await headers()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: who.id, groupId }) })
    const r = await res.json().catch(() => ({}))
    setAdding(false)
    if (!res.ok) { setAddNote(r.error || 'Could not add them. Try again.'); return }
    setAddNote(`✓ ${who.full_name || 'They'} added to ${groupName}.`)
    setCandidates(c => c.filter(x => x.id !== who.id)); setAddPick('')
    await loadTable(groupId, true)
  }

  async function nudgeMember(id: string, name: string) {
    const text = nudgeText.trim()
    if (!text) return
    setNudging(true); setNudgeNote(null)
    const res = await fetch('/api/admin/nudge-member', { method: 'POST',
      headers: { ...(await headers()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id, message: text }) })
    const r = await res.json().catch(() => ({}))
    setNudging(false)
    if (!res.ok) { setNudgeNote({ id, text: `Could not send: ${r.error || res.status}` }); return }
    const first = name.split(' ')[0]
    setNudgeNote({ id, text: r.pushed ? `✓ Sent to ${first}'s phone.` : r.emailed ? `✓ ${first} has notifications off, so it went by email.` : `${first} has no notifications and no email on file, so it could not be delivered.` })
    if (r.pushed || r.emailed) setNudgeText('')
  }

  // Follow the "Working in" bar.
  const switchRef = useRef<(gid: string) => void>(() => {})
  useEffect(() => onCurrentTableChange(gid => switchRef.current(gid)), [])

  async function switchTable(gid: string) {
    if (gid === groupId || !tables.some(t => t.id === gid)) return
    setGroupId(gid); setDetail(null); setOpen(null); setAddOpen(false)
    if (gid !== homeGroupId) setView(v => v === 'you' ? 'chat' : v)
    setSendMode(null); setSendText(''); setSendNote(''); setNudgeText(''); setNudgeNote(null)
    const t = tables.find(x => x.id === gid); if (t) setGroupName(t.name)
    await loadTable(gid, isLeader)
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

  switchRef.current = switchTable
  const onHome = groupId === homeGroupId
  // Members: You · Follow-ups · Chat. Follow-ups (2026-10-09) is the TC's
  // meeting follow-ups with replies, apart from the chat. The Table tab (who
  // is at the table, the TC send card, member detail) is TC-only — members
  // do not need a view of everyone else's progress (2026-10-07).
  const tabs = ([['you', '✅ You'], ['followups', '📝 Follow-ups'], ['chat', '💬 Chat'], ['people', '👥 Table']] as const)
    .filter(([k]) => (k !== 'you' || onHome) && (k !== 'people' || isLeader))

  return (
    <div style={{ height: '100dvh' }} className="bg-bt-pale flex flex-col">
      <div className="bg-bt-navy px-5 pt-16 pb-0 flex-shrink-0">
        {/* pr-10: the top-right corner belongs to the notifications bell. */}
        <div className="flex items-start justify-between gap-3 pr-10">
          <div className="min-w-0">
            <h1 className="text-white text-2xl font-bold truncate">{groupName}</h1>
            <p className="text-bt-light/60 text-sm mt-0.5">{members.length} {members.length === 1 ? 'person' : 'people'} at the table</p>
          </div>
          {isLeader && (
            <Link href="/analytics" className="flex-shrink-0 bg-white/15 text-white text-xs font-semibold px-3 py-2 rounded-xl mt-1">
              📊 Stats
            </Link>
          )}
        </div>
        <div className="flex gap-0.5 mt-4 overflow-x-auto">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-2 rounded-t-xl text-sm font-semibold whitespace-nowrap transition-colors ${
                view === k ? 'bg-bt-pale text-bt-navy' : 'text-white/60 hover:text-white/80'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'followups' && groupId && (
        <FollowUps groupId={groupId} groupName={groupName} userId={currentUserId} />
      )}

      {view === 'chat' && groupId && (
        <TableChat groupId={groupId} groupName={groupName} homeGroupId={homeGroupId} userId={currentUserId} />
      )}

      {/* You — only on the table you sit at: your reading belongs to it. */}
      {view === 'you' && onHome && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 pb-36">
          <MyTasks />
        </div>
      )}

      {view === 'people' && (
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 pb-36 space-y-3">
        {isLeader && detail && (
          <p className="text-gray-400 text-xs px-1">TC view: tap a member for their habits, reading, attendance and more.</p>
        )}

        {isLeader && detail && (
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            <h3 className="font-bold text-bt-navy text-sm">Send to {groupName}</h3>
            <button type="button" onClick={() => { setSendMode(sendMode ? null : 'message'); setSendNote('') }}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold border ${sendMode ? 'bg-bt-navy text-white border-bt-navy' : 'bg-white text-bt-navy border-gray-200'}`}>
              📣 Message
            </button>
            {sendMode && (
              <>
                <p className="text-gray-400 text-xs">Goes to everyone at this table now: by push, or by email if their notifications are off.</p>
                <textarea value={sendText} onChange={e => setSendText(e.target.value)} rows={3}
                  placeholder="Type your message..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base text-gray-900 resize-none leading-relaxed focus:outline-none focus:ring-2 focus:ring-bt-blue" />
                <button onClick={sendToTable} disabled={sending || !sendText.trim()}
                  className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                  {sending ? 'Sending...' : 'Send to Table Now'}
                </button>
              </>
            )}
            {sendNote && <p className={`text-xs ${sendNote.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{sendNote}</p>}
          </div>
        )}

        {isLeader && detail && (
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            <button type="button" onClick={openAddMember}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold border ${addOpen ? 'bg-bt-navy text-white border-bt-navy' : 'bg-white text-bt-navy border-gray-200'}`}>
              ➕ Add a member
            </button>
            {addOpen && (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-bt-navy">New to the app</p>
                  <p className="text-gray-400 text-xs">Send them this link. When they sign up they land at {groupName}.</p>
                  {invite && <p className="text-xs text-gray-600 break-all font-mono bg-bt-pale rounded-lg px-3 py-2">{invite}</p>}
                  {invite && (
                    <button type="button" onClick={shareInvite}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold border-2 border-bt-blue text-bt-blue">
                      Share invite link
                    </button>
                  )}
                  {inviteNote && <p className={`text-xs ${inviteNote.startsWith('✓') ? 'text-green-600' : 'text-gray-500'}`}>{inviteNote}</p>}
                </div>
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <p className="text-xs font-semibold text-bt-navy">Already in the app</p>
                  <select value={addPick} onChange={e => setAddPick(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base text-gray-900 bg-white">
                    <option value="">{candidates.length ? 'Pick someone...' : 'Nobody else to add'}</option>
                    {candidates.map(c => {
                      const at = c.group_id ? tables.find(t => t.id === c.group_id)?.name : null
                      return <option key={c.id} value={c.id}>{c.full_name || 'Unnamed'}{at ? ` — at ${at}` : ' — no table yet'}</option>
                    })}
                  </select>
                  <button type="button" onClick={seatMember} disabled={!addPick || adding}
                    className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                    {adding ? 'Adding...' : `Add to ${groupName}`}
                  </button>
                  {addNote && <p className={`text-xs ${addNote.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{addNote}</p>}
                </div>
              </>
            )}
          </div>
        )}

        {members.map(member => {
          const isYou = member.id === currentUserId
          const d = detailById.get(member.id)
          const expanded = open === member.id
          return (
            <div key={member.id}
              className={`bg-white rounded-2xl px-4 py-4 shadow-sm ${isYou ? 'ring-2 ring-bt-blue' : ''}`}>
              <div className={`flex items-center gap-3 ${d ? 'cursor-pointer' : ''}`} onClick={() => { if (!d) return; setOpen(expanded ? null : member.id); setNudgeText(''); setNudgeNote(null) }}>
                <Avatar src={member.avatar_url} name={member.full_name}
                  className={`w-10 h-10 ${isYou ? 'bg-bt-blue' : 'bg-bt-pale'}`}
                  textClass={`font-bold text-sm ${isYou ? 'text-white' : 'text-bt-navy'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-semibold text-gray-900 text-sm">
                      {member.full_name}{isYou ? ' (you)' : ''}
                    </p>
                    {member.role === 'leader' && (
                      <span className="text-xs bg-bt-navy text-white px-2 py-0.5 rounded-full">Leader</span>
                    )}
                    {d && !d.push_enabled && <span className="text-xs" title="No notifications">🔕</span>}
                  </div>
                </div>
{(member.streak || 0) > 0 && (
                  <span className="flex-shrink-0 text-sm font-semibold text-orange-500">🔥 {member.streak}</span>
                )}
                {d && <span className={`flex-shrink-0 text-gray-300 text-sm transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>}
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
                    <div className="bg-bt-pale rounded-xl p-3"><p className="text-gray-400">Notifications</p><p className={`font-bold text-base ${d.push_enabled ? 'text-green-600' : 'text-amber-600'}`}>{d.push_enabled ? 'On' : 'Off'}</p></div>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Period streak {d.streak} · joined {fmt(d.joined)}{d.email ? ` · ${d.email}` : ''}
                  </p>
                  {!isYou && (
                    <div className="pt-3 border-t border-gray-100 space-y-2">
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Nudge {member.full_name?.split(' ')[0]}</p>
                      <textarea value={nudgeText} onChange={e => setNudgeText(e.target.value)} rows={2} maxLength={500}
                        placeholder="e.g. Missed you on your habit this week. Want to talk it through?"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-base text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-bt-blue" />
                      <button onClick={() => nudgeMember(member.id, member.full_name || '')} disabled={nudging || !nudgeText.trim()}
                        className="w-full bg-bt-blue text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40">
                        {nudging ? 'Sending...' : `👋 Send to ${member.full_name?.split(' ')[0] || 'member'}`}
                      </button>
                      {nudgeNote && nudgeNote.id === member.id && (
                        <p className={`text-xs ${nudgeNote.text.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{nudgeNote.text}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {members.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">No members in this group yet.</p>
        )}
      </div>
      )}
      <BottomNav />
    </div>
  )
}
