'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import Link from 'next/link'
import Avatar from '@/components/Avatar'
import MyTasks from '@/components/MyTasks'
import TableChat from '@/components/TableChat'
import { notifyAbout } from '@/lib/notify-client'

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
  const [view, setView] = useState<'chat' | 'you' | 'people'>('you')
  // TC quick-send: a prompt or a message to the selected table, and a
  // personal nudge to one member — without a trip to Admin.
  const [sendMode, setSendMode] = useState<'prompt' | 'message' | 'reading' | null>(null)
  const [sendText, setSendText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendNote, setSendNote] = useState('')
  const [nudgeText, setNudgeText] = useState('')
  const [nudging, setNudging] = useState(false)
  const [nudgeNote, setNudgeNote] = useState<{ id: string; text: string } | null>(null)
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
      if (want === 'you' || want === 'chat' || (want === 'people' && prof?.role === 'leader')) setView(want)
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
      // ?table=<id> from a chat notification opens that table, if it is one of mine.
      const wantTable = new URLSearchParams(window.location.search).get('table')
      if (wantTable && !want) setView('chat')
      const first = (wantTable && all.find(t => t.id === wantTable)?.id) || all[0]?.id || null
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
    if (sendMode === 'message' && !confirm(`Send this to everyone at ${groupName}?`)) return
    setSending(true); setSendNote('')
    const h = { ...(await headers()), 'Content-Type': 'application/json' }
    try {
      if (sendMode === 'reading') {
        // First line is the title, anything after it the description.
        const [title, ...rest] = text.split('\n')
        const res = await fetch('/api/admin/post-item', { method: 'POST', headers: h,
          body: JSON.stringify({ table: 'tasks', rows: [{ group_id: groupId, title: title.trim(), description: rest.join('\n').trim() }] }) })
        const r = await res.json().catch(() => ({}))
        if (!res.ok) { setSendNote(`Could not post: ${r.detail || r.error || res.status}`); return }
        for (const row of r.items || []) notifyAbout('task', row.id)
        setSendNote(`✓ Added to ${groupName}'s Reading & Resources.`)
      } else if (sendMode === 'prompt') {
        const res = await fetch('/api/admin/post-item', { method: 'POST', headers: h,
          body: JSON.stringify({ table: 'journal_prompts', rows: [{ group_id: groupId, prompt: text }] }) })
        const r = await res.json().catch(() => ({}))
        if (!res.ok) { setSendNote(`Could not post: ${r.detail || r.error || res.status}`); return }
        for (const row of r.items || []) notifyAbout('prompt', row.id)
        setSendNote(`✓ Prompt posted to ${groupName}. Members will see it in Reflections.`)
      } else {
        const res = await fetch('/api/send-broadcast', { method: 'POST', headers: h,
          body: JSON.stringify({ group_id: groupId, message: text, scope: 'table' }) })
        const r = await res.json().catch(() => ({}))
        if (!res.ok) { setSendNote(`Could not send: ${r.error || res.status}`); return }
        const parts = [`${r.sent} by push`]
        if (r.emailed) parts.push(`${r.emailed} by email`)
        setSendNote(`✓ Sent to ${r.recipients} member${r.recipients === 1 ? '' : 's'} (${parts.join(', ')}).`)
      }
      setSendText(''); setSendMode(null)
    } finally {
      setSending(false)
    }
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

  async function switchTable(gid: string) {
    setGroupId(gid); setDetail(null); setOpen(null)
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

  const onHome = groupId === homeGroupId
  // Members: You · Chat. The Table tab (who is at the table, the TC send
  // card, member detail) is TC-only — members do not need a view of everyone
  // else's progress (2026-10-07).
  const tabs = ([['you', '✅ You'], ['people', '👥 Table'], ['chat', '💬 Chat']] as const)
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
        {isLeader && tables.length > 1 && (
          <select value={groupId || ''} onChange={e => switchTable(e.target.value)}
            className="mt-3 w-full bg-white/15 text-white text-sm rounded-xl px-3 py-2 border border-white/25 focus:outline-none">
            {tables.map(t => <option key={t.id} value={t.id} className="text-gray-900">{t.name}{t.id === homeGroupId ? ' (your table)' : ''}</option>)}
          </select>
        )}
        <div className="flex gap-1 mt-4">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3.5 py-2 rounded-t-xl text-sm font-semibold transition-colors ${
                view === k ? 'bg-bt-pale text-bt-navy' : 'text-white/60 hover:text-white/80'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'chat' && groupId && (
        <TableChat groupId={groupId} groupName={groupName} homeGroupId={homeGroupId} userId={currentUserId} />
      )}

      {/* You — only on the table you sit at: your reading belongs to it. */}
      {view === 'you' && onHome && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 pb-28">
          <MyTasks />
        </div>
      )}

      {view === 'people' && (
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 pb-28 space-y-3">
        {isLeader && detail && (
          <p className="text-gray-400 text-xs px-1">TC view: tap a member for their habits, reading, attendance and more.</p>
        )}

        {isLeader && detail && (
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            <h3 className="font-bold text-bt-navy text-sm">Send to {groupName}</h3>
            <div className="grid grid-cols-3 gap-2">
              {([['reading', '📚 Reading'], ['prompt', '✍️ Prompt'], ['message', '📣 Message']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => { setSendMode(sendMode === k ? null : k); setSendNote('') }}
                  className={`py-2.5 rounded-xl text-sm font-semibold border ${sendMode === k ? 'bg-bt-navy text-white border-bt-navy' : 'bg-white text-bt-navy border-gray-200'}`}>
                  {label}
                </button>
              ))}
            </div>
            {sendMode && (
              <>
                <p className="text-gray-400 text-xs">
                  {sendMode === 'reading'
                    ? 'Added to Reading & Resources on everyone\'s You tab, with a notification. First line is the title; put a link or note on the next line.'
                    : sendMode === 'prompt'
                    ? 'Members see this in their Reflections tab and get a notification.'
                    : 'Goes to everyone at this table now: by push, or by email if their notifications are off.'}
                </p>
                <textarea value={sendText} onChange={e => setSendText(e.target.value)} rows={3}
                  placeholder={sendMode === 'reading' ? 'e.g. Read chapter 2 of As a Man Thinketh\nhttps://…' : sendMode === 'prompt' ? "e.g. What's one belief you're ready to let go of?" : 'Type your message...'}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base text-gray-900 resize-none leading-relaxed focus:outline-none focus:ring-2 focus:ring-bt-blue" />
                <button onClick={sendToTable} disabled={sending || !sendText.trim()}
                  className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                  {sending ? 'Sending...' : sendMode === 'reading' ? 'Add Reading' : sendMode === 'prompt' ? 'Post Prompt' : 'Send to Table Now'}
                </button>
              </>
            )}
            {sendNote && <p className={`text-xs ${sendNote.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{sendNote}</p>}
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
                  {d && (
                    <p className="text-[11px] text-gray-400 mt-1.5">
                      {d.habits.filter(h => h.done).length}/{d.habits.length} habits · {d.tasks_done}/{detail?.tasks_total ?? 0} reading
                    </p>
                  )}
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
                    <div className="bg-bt-pale rounded-xl p-3"><p className="text-gray-400">Prompts answered</p><p className="font-bold text-bt-navy text-base">{d.prompts_answered} <span className="text-gray-400 font-normal">of {detail?.prompts_total ?? 0}</span></p></div>
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
