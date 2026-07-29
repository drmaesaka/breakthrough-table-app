'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import { MEETING_PLANS, type MeetingPlan } from '@/lib/meeting-plans'
import { localDay } from '@/lib/dates'

type Tab = 'tasks' | 'content' | 'prompts' | 'groups' | 'members' | 'scores' | 'notifications' | 'events' | 'rooms' | 'meetings'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('tasks')
  const [groups, setGroups] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [content, setContent] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [loading, setLoading] = useState(true)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [periodLabel, setPeriodLabel] = useState('')
  const [contentTitle, setContentTitle] = useState('')
  const [contentUrl, setContentUrl] = useState('')
  const [contentType, setContentType] = useState('video')
  const [contentDesc, setContentDesc] = useState('')
  const [groupName, setGroupName] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [copiedGroupId, setCopiedGroupId] = useState('')
  const [contentError, setContentError] = useState('')
  const [contentSaving, setContentSaving] = useState(false)
  const [memberFilter, setMemberFilter] = useState('all')
  const [prompts, setPrompts] = useState<any[]>([])
  const [promptText, setPromptText] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)

  // Inline editing (tasks, content, events, prompts) — one item at a time
  const [editing, setEditing] = useState<{ table: string; id: string; fields: any } | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Member responses to reflection prompts, keyed by prompt id
  const [journalResponses, setJournalResponses] = useState<Record<string, any[]> | null>(null)

  // Invite links come from the server — codes are unreadable from the browser
  const [inviteLinks, setInviteLinks] = useState<Record<string, { url: string; revocable: boolean }>>({})

  // Notification settings state
  const [notifSettings, setNotifSettings] = useState<any>(null)
  const [checkinEnabled, setCheckinEnabled] = useState(true)
  const [checkinTime, setCheckinTime] = useState('20:00')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderMessage, setReminderMessage] = useState('')
  const [reminderTime, setReminderTime] = useState('12:00')
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifSaved, setNotifSaved] = useState(false)
  const [notifSaveError, setNotifSaveError] = useState(false)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcasting, setBroadcasting] = useState(false)
  const [broadcastSent, setBroadcastSent] = useState(false)

  // Events state
  const [events, setEvents] = useState<any[]>([])
  const [eventTitle, setEventTitle] = useState('')
  const [eventDesc, setEventDesc] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventType, setEventType] = useState('in_person')
  const [eventLocation, setEventLocation] = useState('')
  const [eventLink, setEventLink] = useState('')
  const [eventSaving, setEventSaving] = useState(false)

  // Meetings state
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingPlan | null>(null)

  // Rooms state
  const [rooms, setRooms] = useState<any[]>([])
  const [allBookings, setAllBookings] = useState<any[]>([])
  const [adminBookDate, setAdminBookDate] = useState(localDay())
  const [adminBookUserId, setAdminBookUserId] = useState('')
  const [adminBookRoomId, setAdminBookRoomId] = useState('')
  const [adminBookTime, setAdminBookTime] = useState('')
  const [adminBooking, setAdminBooking] = useState(false)

  const router = useRouter()

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await createClient().auth.getSession()
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    }
  }

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (prof?.role !== 'leader') { router.push('/dashboard'); return }

      const membersReq = await fetch('/api/admin/members', { headers: await authHeaders() })
      const membersRes = await membersReq.json()

      // Only the tables this leader actually runs, in a stable order. This used
      // to take groups[0] from an unordered, unfiltered list, so with a second
      // table the panel could silently open on someone else's group.
      const groupsRes = await supabase
        .from('groups')
        .select('*, last_period_start')
        .eq('leader_id', user.id)
        .order('name', { ascending: true })
      const grps = groupsRes.data || []
      setGroups(grps)
      setUsers(membersRes.members || [])
      if (grps[0]) { setSelectedGroup(grps[0].id); loadGroupData(grps[0].id) }
      setLoading(false)
    }
    load()
  }, [router])

  async function loadGroupData(gid: string) {
    const supabase = createClient()
    const [t, c, p, n] = await Promise.all([
      supabase.from('tasks').select('*').eq('group_id', gid).eq('archived', false).order('created_at', { ascending: false }),
      supabase.from('content').select('*').eq('group_id', gid).order('created_at', { ascending: false }),
      supabase.from('journal_prompts').select('*').eq('group_id', gid).order('created_at', { ascending: false }),
      supabase.from('group_notification_settings').select('*').eq('group_id', gid).maybeSingle(),
    ])
    setTasks(t.data || [])
    setContent(c.data || [])
    setPrompts(p.data || [])
    if (n.data) {
      setNotifSettings(n.data)
      setCheckinEnabled(n.data.checkin_enabled ?? true)
      setCheckinTime(n.data.checkin_time || '20:00')
      setReminderEnabled(n.data.reminder_enabled ?? false)
      setReminderMessage(n.data.reminder_message || '')
      setReminderTime(n.data.reminder_time || '12:00')
    } else {
      setNotifSettings(null)
      setCheckinEnabled(true)
      setCheckinTime('20:00')
      setReminderEnabled(false)
      setReminderMessage('')
      setReminderTime('12:00')
    }
  }

  async function saveNotifSettings() {
    if (!selectedGroup) return
    setNotifSaving(true)
    const supabase = createClient()
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const { error } = await supabase.from('group_notification_settings').upsert({
      group_id: selectedGroup,
      checkin_enabled: checkinEnabled,
      checkin_time: checkinTime,
      checkin_timezone: timezone,
      reminder_enabled: reminderEnabled,
      reminder_message: reminderMessage.trim(),
      reminder_time: reminderTime,
    }, { onConflict: 'group_id' })
    setNotifSaving(false)
    if (error) {
      setNotifSaveError(true)
      setTimeout(() => setNotifSaveError(false), 4000)
      return
    }
    setNotifSaved(true)
    setTimeout(() => setNotifSaved(false), 2500)
  }

  async function sendBroadcast() {
    if (!broadcastMessage.trim() || !selectedGroup) return
    setBroadcasting(true)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/send-broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ group_id: selectedGroup, message: broadcastMessage.trim() }),
    })
    const result = await res.json()
    setBroadcasting(false)
    if (!res.ok) {
      alert(`Broadcast failed (${res.status}): ${result.error || JSON.stringify(result)}`)
      return
    }
    setBroadcastSent(true)
    setBroadcastMessage('')
    setTimeout(() => setBroadcastSent(false), 3000)
    alert(`Broadcast sent to ${result.sent} member${result.sent !== 1 ? 's' : ''}!`)
  }

  async function loadEvents(gid: string = selectedGroup) {
    const supabase = createClient()
    const { data } = await supabase.from('events').select('*').order('event_date', { ascending: true })
    // Client-side group filter so this works before AND after the group_id
    // migration: a row without the column (or with NULL) is a legacy shared
    // event and stays visible; stamped rows only show on their own table.
    setEvents((data || []).filter((e: any) => !e.group_id || e.group_id === gid))
  }

  async function addEvent() {
    if (!eventTitle.trim() || !eventDate) return
    setEventSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const row: any = {
      title: eventTitle.trim(),
      description: eventDesc.trim() || null,
      event_date: eventDate,
      event_type: eventType,
      location: eventType === 'in_person' ? eventLocation.trim() || null : null,
      virtual_link: eventType === 'virtual' ? eventLink.trim() || null : null,
      created_by: user!.id,
      group_id: selectedGroup || null,
    }
    let { error } = await supabase.from('events').insert(row)
    // Before the migration the column doesn't exist; retry without it rather
    // than failing the whole add.
    if (error && /group_id/.test(error.message)) {
      delete row.group_id
      ;({ error } = await supabase.from('events').insert(row))
    }
    setEventSaving(false)
    if (error) { alert(`Could not add the event: ${error.message}`); return }
    setEventTitle(''); setEventDesc(''); setEventDate(''); setEventLocation(''); setEventLink('')
    loadEvents()
  }

  async function saveEdit() {
    if (!editing) return
    setEditSaving(true)
    const res = await fetch('/api/admin/edit-item', {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify(editing),
    })
    const result = await res.json().catch(() => ({}))
    setEditSaving(false)
    if (!res.ok) { alert(`Could not save: ${result.error || res.status}`); return }
    const item = result.item
    if (editing.table === 'tasks') setTasks(p => p.map(x => x.id === item.id ? item : x))
    if (editing.table === 'content') setContent(p => p.map(x => x.id === item.id ? item : x))
    if (editing.table === 'events') setEvents(p => p.map(x => x.id === item.id ? item : x))
    if (editing.table === 'journal_prompts') setPrompts(p => p.map(x => x.id === item.id ? item : x))
    setEditing(null)
  }

  async function loadJournalResponses(gid: string) {
    const res = await fetch(`/api/admin/journal?group_id=${gid}`, { headers: await authHeaders() })
    if (!res.ok) { setJournalResponses({}); return }
    const data = await res.json()
    const map: Record<string, any[]> = {}
    for (const p of data.prompts || []) map[p.id] = p.responses
    setJournalResponses(map)
  }

  async function loadInviteLink(gid: string) {
    const res = await fetch(`/api/admin/invite?group_id=${gid}`, { headers: await authHeaders() })
    if (!res.ok) return
    const link = await res.json()
    setInviteLinks(p => ({ ...p, [gid]: link }))
  }

  async function regenerateInvite(gid: string) {
    if (!confirm('Generate a new invite link? The current link stops working immediately.')) return
    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ group_id: gid }),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok) { alert(result.error || 'Could not regenerate the invite link'); return }
    setInviteLinks(p => ({ ...p, [gid]: result }))
  }

  function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
    const csv = rows
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function deleteEvent(id: string) {
    if (!confirm('Delete this event?')) return
    const supabase = createClient()
    await supabase.from('events').delete().eq('id', id)
    setEvents(e => e.filter(x => x.id !== id))
  }

  async function loadRooms() {
    const supabase = createClient()
    const [{ data: r }, { data: b }] = await Promise.all([
      supabase.from('rooms').select('*').order('name'),
      supabase.from('room_bookings')
        .select('*, rooms(name), profiles(full_name)')
        .gte('booking_date', localDay())
        .order('booking_date', { ascending: true }),
    ])
    // A room with no group_id (or from before the column existed) is shared
    // across tables; a stamped room belongs to one table only.
    setRooms((r || []).filter((room: any) => !room.group_id || room.group_id === selectedGroup))
    setAllBookings(b || [])
  }

  async function startNewPeriod() {
    if (!selectedGroup || !periodLabel.trim()) return
    if (!confirm(`Archive all current tasks and start period "${periodLabel}"?`)) return
    setArchiving(true)

    // Group-wide resets run server-side — the browser client can only write
    // its own profile row, so doing this here silently skipped every member.
    const res = await fetch('/api/admin/start-period', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ group_id: selectedGroup }),
    })
    const result = await res.json()
    setArchiving(false)

    if (!res.ok) {
      alert(`Could not start the new period: ${result.error || res.status}`)
      return
    }

    setTasks([])
    setPeriodLabel('')
    const summary = [
      `${result.credited.length} kept their streak`,
      `${result.reset.length} reset`,
      result.failed.length ? `${result.failed.length} FAILED (${result.failed.join(', ')})` : '',
    ].filter(Boolean).join(', ')
    alert(`New period "${periodLabel}" started. ${summary}. Add new tasks below.`)
  }

  async function createGroup() {
    if (!groupName.trim()) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('groups').insert({ name: groupName.trim(), leader_id: user!.id }).select().single()
    if (data) { setGroups(p => [...p, data]); setSelectedGroup(data.id); setGroupName('') }
  }

  async function addTask() {
    if (!taskTitle.trim() || !selectedGroup) return
    const supabase = createClient()
    const currentPeriod = tasks.length > 0 ? tasks[0].period_label : 'Current'
    const { data } = await supabase.from('tasks').insert({
      group_id: selectedGroup,
      title: taskTitle.trim(),
      description: taskDesc.trim(),
      period_label: currentPeriod
    }).select().single()
    if (data) { setTasks(p => [data, ...p]); setTaskTitle(''); setTaskDesc('') }
  }

  async function deleteTask(id: string) {
    const supabase = createClient()
    // Delete completions first to avoid FK constraint
    await supabase.from('task_completions').delete().eq('task_id', id)
    await supabase.from('tasks').delete().eq('id', id)
    setTasks(p => p.filter(t => t.id !== id))
  }

  async function addContent() {
    setContentError('')
    if (!contentTitle.trim()) { setContentError('Title is required'); return }
    if (!contentUrl.trim()) { setContentError('URL is required'); return }
    if (!selectedGroup) { setContentError('No group selected'); return }
    setContentSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase.from('content').insert({
      group_id: selectedGroup, title: contentTitle.trim(), url: contentUrl.trim(),
      type: contentType, description: contentDesc.trim()
    }).select().single()
    setContentSaving(false)
    if (error) { setContentError(error.message); return }
    if (data) { setContent(p => [data, ...p]); setContentTitle(''); setContentUrl(''); setContentDesc('') }
  }

  async function assignUserToGroup(userId: string, groupId: string) {
    const val = groupId === '' ? null : groupId
    const res = await fetch('/api/admin/members', {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify({ userId, groupId: val })
    })
    if (!res.ok) { alert('Could not update group. Please try again.'); return }
    setUsers(p => p.map(u => u.id === userId ? { ...u, group_id: val } : u))
  }

  async function deleteMember(userId: string, name: string) {
    if (!confirm(`Remove ${name} from the app? This cannot be undone.`)) return
    const res = await fetch('/api/admin/members', {
      method: 'DELETE',
      headers: await authHeaders(),
      body: JSON.stringify({ userId })
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      alert(error || 'Could not remove member. Please try again.')
      return
    }
    setUsers(p => p.filter(u => u.id !== userId))
  }

  async function toggleLeader(userId: string, currentRole: string) {
    const newRole = currentRole === 'leader' ? 'participant' : 'leader'
    if (!confirm(`${newRole === 'leader' ? 'Promote to leader' : 'Demote to participant'}?`)) return
    const res = await fetch('/api/admin/members', {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify({ userId, role: newRole })
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      alert(error || 'Could not change role. Please try again.')
      return
    }
    setUsers(p => p.map(u => u.id === userId ? { ...u, role: newRole } : u))
  }

  function daysUntilReset(lastStart: string | null) {
    if (!lastStart) return null
    const start = new Date(lastStart)
    const resetDate = new Date(start)
    resetDate.setDate(resetDate.getDate() + 14)
    const today = new Date()
    const diff = Math.ceil((resetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return diff
  }

  const inputClass = "w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"

  if (loading) return <div className="min-h-screen bg-bt-pale flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-4">
        <h1 className="text-white text-2xl font-bold">Admin Panel</h1>
        {groups.length > 0 && (
          <select value={selectedGroup}
            onChange={e => {
              const gid = e.target.value
              setSelectedGroup(gid)
              loadGroupData(gid)
              setJournalResponses(null)
              if (tab === 'events') loadEvents(gid)
            }}
            className="mt-3 w-full bg-white/15 text-white text-sm rounded-xl px-3 py-2 border border-white/25 focus:outline-none">
            {groups.map(g => <option key={g.id} value={g.id} className="text-gray-900">{g.name}</option>)}
          </select>
        )}
        <div className="flex gap-2 mt-4 pb-1 overflow-x-auto">
          {(['tasks', 'content', 'prompts', 'groups', 'members', 'scores', 'notifications', 'events', 'rooms', 'meetings'] as Tab[]).map(t => (
            <button key={t} onClick={() => {
              setTab(t)
              if (t === 'events') loadEvents()
              if (t === 'rooms') loadRooms()
              if (t === 'meetings') setSelectedMeeting(null)
              if (t === 'prompts' && selectedGroup) loadJournalResponses(selectedGroup)
              if (t === 'groups') groups.forEach(g => { if (!inviteLinks[g.id]) loadInviteLink(g.id) })
            }}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
                tab === t ? 'bg-white text-bt-navy' : 'text-white/60'
              }`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">

        {tab === 'tasks' && (
          <>
            {/* New Period */}
            <div style={{ backgroundColor: '#fefce8', borderColor: '#fde047' }} className="border-2 rounded-2xl p-4 space-y-3">
              <div>
                <h3 className="font-bold text-gray-800">🔄 Start New Period</h3>
                <p className="text-gray-500 text-xs mt-0.5">Archives current tasks and resets adherence for all members.</p>
              </div>
              <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)}
                placeholder="e.g. July–August 2026" className={inputClass} />
              <button onClick={startNewPeriod} disabled={archiving || !periodLabel.trim()}
                style={{ backgroundColor: '#f59e0b' }}
                className="w-full text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                {archiving ? 'Archiving...' : 'Archive Current & Start New Period'}
              </button>
            </div>

            {/* Add Task */}
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-bt-navy">Add Task</h3>
              <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Task title *" className={inputClass} />
              <input value={taskDesc} onChange={e => setTaskDesc(e.target.value)} placeholder="Description (optional)" className={inputClass} />
              <button onClick={addTask} className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm">Add Task</button>
            </div>

            {/* Task list */}
            <div className="space-y-2">
              {tasks.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">No active tasks. Add one above.</p>
              )}
              {tasks.map(task => (
                editing?.table === 'tasks' && editing.id === task.id ? (
                  <div key={task.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm space-y-2">
                    <input value={editing.fields.title}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, title: e.target.value } }))}
                      className={inputClass} placeholder="Task title" />
                    <input value={editing.fields.description || ''}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, description: e.target.value } }))}
                      className={inputClass} placeholder="Description" />
                    <div className="flex gap-2">
                      <button onClick={saveEdit} disabled={editSaving || !editing.fields.title.trim()}
                        className="flex-1 bg-bt-navy text-white py-2 rounded-lg text-xs font-semibold disabled:opacity-40">
                        {editSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditing(null)} className="flex-1 border border-gray-200 text-gray-500 py-2 rounded-lg text-xs font-semibold">Cancel</button>
                    </div>
                  </div>
                ) : (
                <div key={task.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 text-sm">{task.title}</p>
                    {task.description && <p className="text-gray-400 text-xs mt-0.5">{task.description}</p>}
                  </div>
                  <button onClick={() => setEditing({ table: 'tasks', id: task.id, fields: { title: task.title, description: task.description || '' } })}
                    className="text-bt-blue text-sm font-medium px-2 py-1">Edit</button>
                  <button onClick={() => deleteTask(task.id)} className="text-red-400 text-sm font-medium px-2 py-1">Remove</button>
                </div>
                )
              ))}
            </div>
          </>
        )}

        {tab === 'content' && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-bt-navy">Add Content</h3>
              <input value={contentTitle} onChange={e => setContentTitle(e.target.value)} placeholder="Title *" className={inputClass} />
              <input value={contentUrl} onChange={e => setContentUrl(e.target.value)} placeholder="URL *" className={inputClass} />
              <input value={contentDesc} onChange={e => setContentDesc(e.target.value)} placeholder="Description (optional)" className={inputClass} />
              <select value={contentType} onChange={e => setContentType(e.target.value)} className={inputClass}>
                <option value="video">🎥 Video</option>
                <option value="pdf">📄 PDF</option>
                <option value="article">📰 Article</option>
                <option value="link">🔗 Link</option>
              </select>
              {contentError && <p className="text-red-500 text-sm">{contentError}</p>}
              <button onClick={addContent} disabled={contentSaving}
                className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50">
                {contentSaving ? 'Adding...' : 'Add Content'}
              </button>
            </div>
            <div className="space-y-2">
              {content.map(item => (
                editing?.table === 'content' && editing.id === item.id ? (
                  <div key={item.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm space-y-2">
                    <input value={editing.fields.title}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, title: e.target.value } }))}
                      className={inputClass} placeholder="Title" />
                    <input value={editing.fields.url}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, url: e.target.value } }))}
                      className={inputClass} placeholder="URL" />
                    <input value={editing.fields.description || ''}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, description: e.target.value } }))}
                      className={inputClass} placeholder="Description" />
                    <select value={editing.fields.type}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, type: e.target.value } }))}
                      className={inputClass}>
                      <option value="video">🎥 Video</option>
                      <option value="pdf">📄 PDF</option>
                      <option value="article">📰 Article</option>
                      <option value="link">🔗 Link</option>
                    </select>
                    <div className="flex gap-2">
                      <button onClick={saveEdit} disabled={editSaving || !editing.fields.title.trim() || !editing.fields.url.trim()}
                        className="flex-1 bg-bt-navy text-white py-2 rounded-lg text-xs font-semibold disabled:opacity-40">
                        {editSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditing(null)} className="flex-1 border border-gray-200 text-gray-500 py-2 rounded-lg text-xs font-semibold">Cancel</button>
                    </div>
                  </div>
                ) : (
                <div key={item.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 text-sm">{item.title}</p>
                    <p className="text-gray-400 text-xs mt-0.5 capitalize">{item.type}</p>
                  </div>
                  <button onClick={() => setEditing({ table: 'content', id: item.id, fields: { title: item.title, url: item.url, type: item.type, description: item.description || '' } })}
                    className="text-bt-blue text-sm font-medium px-2 py-1">Edit</button>
                  <button onClick={async () => {
                    if (!confirm(`Remove "${item.title}"?`)) return
                    const supabase = createClient()
                    await supabase.from('content').delete().eq('id', item.id)
                    setContent(p => p.filter(c => c.id !== item.id))
                  }} className="text-red-400 text-sm font-medium px-2 py-1">Remove</button>
                </div>
                )
              ))}
            </div>
          </>
        )}

        {tab === 'prompts' && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-bt-navy">Post a Reflection Prompt</h3>
              <p className="text-gray-400 text-xs">Members will see this in their Reflections tab and can write a response before the next meeting.</p>
              <textarea
                value={promptText}
                onChange={e => setPromptText(e.target.value)}
                placeholder="e.g. What's one belief you're ready to let go of? What would change if you did?"
                rows={3}
                className={`${inputClass} resize-none leading-relaxed`}
              />
              <button onClick={async () => {
                if (!promptText.trim() || !selectedGroup) return
                setPromptSaving(true)
                const supabase = createClient()
                const { data: { user } } = await supabase.auth.getUser()
                const { data } = await supabase.from('journal_prompts').insert({
                  group_id: selectedGroup,
                  prompt: promptText.trim(),
                  posted_by: user?.id,
                }).select().single()
                if (data) { setPrompts(p => [data, ...p]); setPromptText('') }
                setPromptSaving(false)
              }} disabled={promptSaving || !promptText.trim()}
                className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                {promptSaving ? 'Posting...' : 'Post Prompt'}
              </button>
            </div>
            {prompts.length > 0 && journalResponses && (
              <button onClick={() => {
                const rows: (string | null)[][] = [['Prompt', 'Posted', 'Member', 'Response']]
                for (const p of prompts) {
                  const responses = journalResponses[p.id] || []
                  if (responses.length === 0) rows.push([p.prompt, p.created_at, '', ''])
                  for (const r of responses) rows.push([p.prompt, p.created_at, r.name, r.response])
                }
                downloadCSV(`reflections-${new Date().toISOString().split('T')[0]}.csv`, rows)
              }}
                className="w-full py-2.5 rounded-xl text-sm font-semibold border-2 border-gray-200 text-gray-500">
                ⬇ Export responses (CSV)
              </button>
            )}
            <div className="space-y-2">
              {prompts.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">No prompts yet. Post one above.</p>
              )}
              {prompts.map((p: any) => {
                const responses = journalResponses?.[p.id]
                return editing?.table === 'journal_prompts' && editing.id === p.id ? (
                  <div key={p.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm space-y-2">
                    <textarea value={editing.fields.prompt} rows={3}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, prompt: e.target.value } }))}
                      className={`${inputClass} resize-none leading-relaxed`} />
                    <div className="flex gap-2">
                      <button onClick={saveEdit} disabled={editSaving || !editing.fields.prompt.trim()}
                        className="flex-1 bg-bt-navy text-white py-2 rounded-lg text-xs font-semibold disabled:opacity-40">
                        {editSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditing(null)} className="flex-1 border border-gray-200 text-gray-500 py-2 rounded-lg text-xs font-semibold">Cancel</button>
                    </div>
                  </div>
                ) : (
                <div key={p.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 leading-snug">{p.prompt}</p>
                      <p className="text-gray-400 text-xs mt-1">{new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                    </div>
                    <button onClick={() => setEditing({ table: 'journal_prompts', id: p.id, fields: { prompt: p.prompt } })}
                      className="text-bt-blue text-sm font-medium px-2 py-1 flex-shrink-0">Edit</button>
                    <button onClick={async () => {
                      if (!confirm('Delete this prompt?')) return
                      const supabase = createClient()
                      await supabase.from('journal_prompts').delete().eq('id', p.id)
                      setPrompts(prev => prev.filter(x => x.id !== p.id))
                    }} className="text-red-400 text-sm font-medium px-2 py-1 flex-shrink-0">Remove</button>
                  </div>
                  {/* Member responses — the leader-facing view that didn't exist:
                      /journal only ever showed the caller's own group page. */}
                  <div className="mt-2 pt-2 border-t border-gray-50">
                    {!responses && <p className="text-gray-300 text-xs">Loading responses…</p>}
                    {responses && responses.length === 0 && (
                      <p className="text-gray-400 text-xs">No responses yet</p>
                    )}
                    {responses && responses.map((r: any, i: number) => (
                      <div key={i} className="py-1.5">
                        <p className="text-xs font-semibold text-bt-navy">{r.name}</p>
                        <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{r.response}</p>
                      </div>
                    ))}
                  </div>
                </div>
                )
              })}
            </div>
          </>
        )}

        {tab === 'groups' && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-bt-navy">Create New Group</h3>
              <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" className={inputClass} />
              <button onClick={createGroup} className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm">Create Group</button>
            </div>
            <div className="space-y-3">
              {groups.map(g => {
                // Server-issued link (revocable invite code once the migration
                // has run); the legacy ?group= link only until then.
                const link = inviteLinks[g.id]
                const inviteLink = link?.url || `${process.env.NEXT_PUBLIC_APP_URL}/join?group=${g.id}`
                const copied = copiedGroupId === g.id
                return (
                  <div key={g.id} className="bg-white rounded-2xl px-4 py-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{g.name}</p>
                        <p className="text-gray-400 text-xs mt-0.5">{users.filter(u => u.group_id === g.id).length} members</p>
                        {(() => {
                          const days = daysUntilReset(g.last_period_start)
                          if (days === null) return null
                          if (days <= 0) return <p className="text-red-500 text-xs font-semibold mt-0.5">⚠️ Period reset overdue</p>
                          if (days <= 3) return <p className="text-orange-500 text-xs font-semibold mt-0.5">⏰ Reset in {days} day{days !== 1 ? 's' : ''}</p>
                          return <p className="text-gray-400 text-xs mt-0.5">🗓 Reset in {days} days</p>
                        })()}
                      </div>
                    </div>
                    <div className="bg-bt-pale rounded-xl p-3">
                      <p className="text-xs text-gray-400 mb-1.5 font-medium">Invite Link</p>
                      <p className="text-xs text-gray-600 break-all font-mono leading-relaxed">{inviteLink}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(inviteLink)
                          setCopiedGroupId(g.id)
                          setTimeout(() => setCopiedGroupId(''), 2500)
                        }}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 border-bt-blue text-bt-blue transition-colors">
                        {copied ? '✓ Copied!' : 'Copy Invite Link'}
                      </button>
                      {link?.revocable && (
                        <button
                          onClick={() => regenerateInvite(g.id)}
                          title="Invalidate the current link and create a new one"
                          className="px-4 py-2.5 rounded-xl text-sm font-semibold border-2 border-gray-200 text-gray-500 transition-colors">
                          ↻ New Link
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {tab === 'members' && (
          <div className="space-y-3">
            {/* Who cannot receive notifications — otherwise invisible until
                their nudge time arrives and quietly delivers nothing. */}
            {(() => {
              const noPush = users.filter(u => !u.push_enabled)
              if (noPush.length === 0) return null
              return (
                <div className="bg-amber-50 border-2 border-amber-100 rounded-2xl p-4">
                  <p className="font-semibold text-amber-800 text-sm">
                    🔕 {noPush.length} of {users.length} can&apos;t receive notifications
                  </p>
                  <p className="text-amber-700 text-xs mt-1 leading-relaxed">
                    {noPush.map(u => u.full_name).join(', ')} — nudges are calculated for them but
                    have nowhere to go. On iPhone they must add the app to their Home Screen, open it
                    from there, then tap Allow in Nudge Settings.
                  </p>
                </div>
              )
            })()}

            {/* Filter dropdown */}
            <select
              value={memberFilter}
              onChange={e => setMemberFilter(e.target.value)}
              className={inputClass}>
              <option value="all">All Members ({users.length})</option>
              <option value="unassigned">Unassigned</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>
                  {g.name} ({users.filter(u => u.group_id === g.id).length})
                </option>
              ))}
            </select>

            {/* Filtered list */}
            {(() => {
              const filtered = memberFilter === 'all'
                ? users
                : memberFilter === 'unassigned'
                ? users.filter(u => !u.group_id)
                : users.filter(u => u.group_id === memberFilter)
              if (filtered.length === 0) return (
                <p className="text-center text-gray-400 text-sm py-8">No members in this view</p>
              )
              return filtered.map(u => {
              const groupForUser = groups.find(g => g.id === u.group_id)
              return (
                <div key={u.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-bt-pale flex items-center justify-center flex-shrink-0">
                      <span className="text-bt-navy font-bold text-xs">
                        {(() => { const p = (u.full_name||'').trim().split(' '); return p.length>=2?(p[0][0]+p[p.length-1][0]).toUpperCase():u.full_name?.slice(0,2).toUpperCase()||'?' })()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900 text-sm">{u.full_name}</p>
                        {u.role === 'leader' && (
                          <span className="text-xs bg-bt-navy text-white px-2 py-0.5 rounded-full">Leader</span>
                        )}
                        {!u.push_enabled && (
                          <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">🔕 No notifications</span>
                        )}
                      </div>
                      <p className="text-gray-400 text-xs">{groupForUser?.name || 'Unassigned'}</p>
                    </div>
                  </div>
                  {/* Inline group assignment */}
                  <select
                    value={u.group_id || ''}
                    onChange={e => assignUserToGroup(u.id, e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-bt-blue bg-bt-pale">
                    <option value="">— Unassigned —</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => toggleLeader(u.id, u.role)}
                      className={`flex-1 text-xs font-medium py-2 rounded-lg border transition-colors ${
                        u.role === 'leader' ? 'border-gray-200 text-gray-400' : 'border-bt-blue text-bt-blue'
                      }`}>
                      {u.role === 'leader' ? 'Demote' : 'Make Leader'}
                    </button>
                    <button onClick={() => deleteMember(u.id, u.full_name)}
                      className="flex-1 text-xs font-medium py-2 rounded-lg border border-red-200 text-red-400 transition-colors">
                      Remove
                    </button>
                  </div>
                </div>
              )
            })
            })()}
          </div>
        )}

        {tab === 'scores' && (
          <div className="space-y-4">
            <button onClick={() => {
              const rows: (string | number | null)[][] = [['Name', 'Table', 'Role', 'Adherence %', 'Period streak', 'Push enabled']]
              for (const u of users) {
                rows.push([
                  u.full_name,
                  groups.find(g => g.id === u.group_id)?.name || 'Unassigned',
                  u.role,
                  u.adherence_percent ?? 0,
                  u.streak ?? 0,
                  u.push_enabled ? 'yes' : 'no',
                ])
              }
              downloadCSV(`members-${new Date().toISOString().split('T')[0]}.csv`, rows)
            }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold border-2 border-gray-200 text-gray-500">
              ⬇ Export members & scores (CSV)
            </button>
            {groups.map(g => {
              const members = users.filter(u => u.group_id === g.id).sort((a,b) => (b.adherence_percent||0)-(a.adherence_percent||0))
              const avg = members.length > 0 ? Math.round(members.reduce((s,m) => s+(m.adherence_percent||0),0)/members.length) : 0
              const at100 = members.filter(m => m.adherence_percent === 100).length
              return (
                <div key={g.id} className="space-y-2">
                  <div className="bg-bt-navy rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-white font-bold">{g.name}</h3>
                      <span className="text-bt-light/60 text-xs">{members.length} members</span>
                    </div>
                    <div className="flex gap-4">
                      <div className="text-center">
                        <p className="text-white text-xl font-bold">{avg}%</p>
                        <p className="text-bt-light/50 text-xs">Avg</p>
                      </div>
                      <div className="text-center">
                        <p className="text-white text-xl font-bold">{at100}</p>
                        <p className="text-bt-light/50 text-xs">At 100%</p>
                      </div>
                      <div className="text-center">
                        <p className="text-white text-xl font-bold">{members.length - at100}</p>
                        <p className="text-bt-light/50 text-xs">Incomplete</p>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div className="h-full bg-bt-light rounded-full" style={{ width: `${avg}%` }} />
                    </div>
                  </div>
                  {members.map((m, i) => {
                    const pct = m.adherence_percent || 0
                    const color = pct === 100 ? '#22c55e' : pct >= 75 ? '#5B9BD5' : pct > 0 ? '#f59e0b' : '#e5e7eb'
                    return (
                      <div key={m.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
                        <span className="text-sm w-5 text-center">{i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900 truncate">{m.full_name}</p>
                            {m.streak > 0 && <span className="text-xs text-orange-500">{m.streak}🔥</span>}
                          </div>
                          <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                        </div>
                        <span className={`text-sm font-bold w-10 text-right ${pct===100?'text-green-500':pct>=75?'text-bt-blue':'text-gray-400'}`}>{pct}%</span>
                      </div>
                    )
                  })}
                  {members.length === 0 && <p className="text-center text-gray-400 text-sm py-3 bg-white rounded-2xl">No members yet</p>}
                </div>
              )
            })}
          </div>
        )}
        {tab === 'notifications' && (
          <div className="space-y-4">

            {/* Daily Check-in */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-bt-navy">Daily Check-in Push</h3>
                  <p className="text-gray-400 text-xs mt-0.5">Reminds everyone to log habit + reading once per day</p>
                </div>
                <button onClick={() => setCheckinEnabled(!checkinEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${checkinEnabled ? 'bg-bt-navy' : 'bg-gray-200'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checkinEnabled ? 'translate-x-6' : ''}`} />
                </button>
              </div>
              {checkinEnabled && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Send at (your local time)</label>
                  <select value={checkinTime} onChange={e => setCheckinTime(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue bg-white">
                    {['06:00','06:30','07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
                      '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30',
                      '18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00','22:30'].map(t => {
                      const [h, m] = t.split(':').map(Number)
                      const ampm = h >= 12 ? 'PM' : 'AM'
                      const hour = h % 12 || 12
                      return <option key={t} value={t}>{hour}:{m.toString().padStart(2,'0')} {ampm}</option>
                    })}
                  </select>
                  <p className="text-xs text-gray-400 mt-1.5">Message sent: "Hey [Name] — time to check in your habit and reading for today! 📋"</p>
                </div>
              )}
            </div>

            {/* Scheduled Reminder */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-bt-navy">Scheduled Reminder</h3>
                  <p className="text-gray-400 text-xs mt-0.5">Your message, sent daily at a set time. No link.</p>
                </div>
                <button onClick={() => setReminderEnabled(!reminderEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${reminderEnabled ? 'bg-bt-navy' : 'bg-gray-200'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${reminderEnabled ? 'translate-x-6' : ''}`} />
                </button>
              </div>
              {reminderEnabled && (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Message</label>
                    <textarea
                      value={reminderMessage}
                      onChange={e => setReminderMessage(e.target.value)}
                      placeholder="e.g. The standard you walk past is the standard you accept. Show up today."
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Send at (your local time)</label>
                    <select value={reminderTime} onChange={e => setReminderTime(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue bg-white">
                      {['06:00','06:30','07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
                        '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30',
                        '18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00','22:30'].map(t => {
                        const [h, m] = t.split(':').map(Number)
                        const ampm = h >= 12 ? 'PM' : 'AM'
                        const hour = h % 12 || 12
                        return <option key={t} value={t}>{hour}:{m.toString().padStart(2,'0')} {ampm}</option>
                      })}
                    </select>
                  </div>
                </>
              )}
            </div>

            <button onClick={saveNotifSettings} disabled={notifSaving}
              className={`w-full py-4 rounded-2xl font-semibold disabled:opacity-50 ${notifSaveError ? 'bg-red-600 text-white' : 'bg-bt-navy text-white'}`}>
              {notifSaving ? 'Saving...' : notifSaveError ? "Couldn't save — try again" : notifSaved ? '✓ Saved!' : 'Save Notification Settings'}
            </button>

            {/* Broadcast */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <div>
                <h3 className="font-bold text-bt-navy">Send Broadcast Now</h3>
                <p className="text-gray-400 text-xs mt-0.5">One-time push to everyone on this table. No link.</p>
              </div>
              <textarea
                value={broadcastMessage}
                onChange={e => setBroadcastMessage(e.target.value)}
                placeholder="Type your message to the table..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue resize-none"
              />
              <button onClick={sendBroadcast} disabled={broadcasting || !broadcastMessage.trim()}
                className="w-full bg-bt-blue text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                {broadcasting ? 'Sending...' : broadcastSent ? '✓ Sent!' : '📣 Send to Table Now'}
              </button>
            </div>

          </div>
        )}

        {tab === 'events' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <h3 className="font-bold text-bt-navy">Add Event</h3>
              <input value={eventTitle} onChange={e => setEventTitle(e.target.value)}
                placeholder="Event title" className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue" />
              <textarea value={eventDesc} onChange={e => setEventDesc(e.target.value)}
                placeholder="Description (optional)" rows={2}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue resize-none" />
              <input type="datetime-local" value={eventDate} onChange={e => setEventDate(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue" />
              <div className="flex gap-2">
                {['in_person', 'virtual'].map(t => (
                  <button key={t} onClick={() => setEventType(t)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 ${eventType === t ? 'border-bt-navy bg-bt-pale text-bt-navy' : 'border-gray-100 text-gray-500'}`}>
                    {t === 'in_person' ? '📍 In Person' : '💻 Virtual'}
                  </button>
                ))}
              </div>
              {eventType === 'in_person' && (
                <input value={eventLocation} onChange={e => setEventLocation(e.target.value)}
                  placeholder="Location / address" className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue" />
              )}
              {eventType === 'virtual' && (
                <input value={eventLink} onChange={e => setEventLink(e.target.value)}
                  placeholder="Zoom / meeting link" className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue" />
              )}
              <button onClick={addEvent} disabled={eventSaving || !eventTitle.trim() || !eventDate}
                className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                {eventSaving ? 'Saving...' : 'Add Event'}
              </button>
            </div>

            <div className="space-y-2">
              {events.length === 0 && <p className="text-center text-gray-400 py-6">No events yet</p>}
              {events.map(event => (
                editing?.table === 'events' && editing.id === event.id ? (
                  <div key={event.id} className="bg-white rounded-2xl p-4 shadow-sm space-y-2">
                    <input value={editing.fields.title}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, title: e.target.value } }))}
                      className={inputClass} placeholder="Event title" />
                    <textarea value={editing.fields.description || ''} rows={2}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, description: e.target.value } }))}
                      className={`${inputClass} resize-none`} placeholder="Description" />
                    <input type="datetime-local" value={(editing.fields.event_date || '').slice(0, 16)}
                      onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, event_date: e.target.value } }))}
                      className={inputClass} />
                    <div className="flex gap-2">
                      {['in_person', 'virtual'].map(t => (
                        <button key={t} onClick={() => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, event_type: t } }))}
                          className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 ${editing.fields.event_type === t ? 'border-bt-navy bg-bt-pale text-bt-navy' : 'border-gray-100 text-gray-500'}`}>
                          {t === 'in_person' ? '📍 In Person' : '💻 Virtual'}
                        </button>
                      ))}
                    </div>
                    {editing.fields.event_type === 'in_person' && (
                      <input value={editing.fields.location || ''}
                        onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, location: e.target.value } }))}
                        className={inputClass} placeholder="Location / address" />
                    )}
                    {editing.fields.event_type === 'virtual' && (
                      <input value={editing.fields.virtual_link || ''}
                        onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, virtual_link: e.target.value } }))}
                        className={inputClass} placeholder="Zoom / meeting link" />
                    )}
                    <div className="flex gap-2">
                      <button onClick={saveEdit} disabled={editSaving || !editing.fields.title.trim() || !editing.fields.event_date}
                        className="flex-1 bg-bt-navy text-white py-2 rounded-lg text-xs font-semibold disabled:opacity-40">
                        {editSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditing(null)} className="flex-1 border border-gray-200 text-gray-500 py-2 rounded-lg text-xs font-semibold">Cancel</button>
                    </div>
                  </div>
                ) : (
                <div key={event.id} className="bg-white rounded-2xl p-4 shadow-sm flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-400">{event.event_type === 'virtual' ? '💻' : '📍'}</span>
                      <p className="font-semibold text-gray-900 text-sm">{event.title}</p>
                    </div>
                    <p className="text-xs text-gray-400">{new Date(event.event_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                    {event.location && <p className="text-xs text-gray-400 mt-0.5">📍 {event.location}</p>}
                    {event.virtual_link && <p className="text-xs text-bt-blue mt-0.5 truncate">{event.virtual_link}</p>}
                  </div>
                  <button onClick={() => setEditing({ table: 'events', id: event.id, fields: {
                    title: event.title, description: event.description || '', event_date: event.event_date,
                    event_type: event.event_type, location: event.location || '', virtual_link: event.virtual_link || '',
                  } })} className="text-bt-blue text-xs font-medium flex-shrink-0">Edit</button>
                  <button onClick={() => deleteEvent(event.id)} className="text-red-400 text-xs font-medium flex-shrink-0">Remove</button>
                </div>
                )
              ))}
            </div>
          </div>
        )}

        {tab === 'rooms' && (() => {
          const TIME_SLOTS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00']
          function fmtSlot(t: string) { const [h,m] = t.split(':').map(Number); return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}` }
          function fmtDate(d: string) { return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) }
          const todayStr = localDay()
          const dayBookings = allBookings.filter((b:any) => b.booking_date === adminBookDate)
          // Derived from the rooms themselves rather than hardcoded. This read
          // ['Suite 1','Suite 2'] while the member booking page uses
          // ['Suite 145','Suite 120'], so every suite group matched nothing and
          // the whole dashboard rendered blank.
          const suites = Array.from(new Set(rooms.map((r: any) => r.suite).filter(Boolean)))

          return (
            <div className="space-y-5">

              {/* Dashboard — pick a date, see all rooms */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-bt-navy">Room Dashboard</h3>
                </div>
                <input type="date" value={adminBookDate} min={todayStr}
                  onChange={async e => {
                    setAdminBookDate(e.target.value)
                    const supabase = createClient()
                    const { data } = await supabase.from('room_bookings')
                      .select('*, rooms(name,suite), profiles(full_name)')
                      .eq('booking_date', e.target.value)
                      .order('start_time')
                    setAllBookings(data || [])
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue" />

                {suites.map(suite => {
                  const suiteRooms = rooms.filter(r => r.suite === suite)
                  if (!suiteRooms.length) return null
                  return (
                    <div key={suite}>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">{suite}</p>
                      <div className="space-y-2">
                        {suiteRooms.map(room => {
                          const roomBookings = dayBookings.filter((b:any) => b.room_id === room.id)
                          const bookedSlots = new Set(roomBookings.map((b:any) => b.start_time))
                          const available = TIME_SLOTS.some(s => !bookedSlots.has(s))
                          return (
                            <div key={room.id} className="rounded-xl border border-gray-100 overflow-hidden">
                              <div className="flex items-center gap-3 px-4 py-3 bg-bt-pale">
                                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${available ? 'bg-green-400' : 'bg-red-400'}`} />
                                <div className="flex-1">
                                  <p className="font-semibold text-sm text-gray-900">{room.name}</p>
                                  <p className="text-xs text-gray-400">{room.room_type === 'private_office' ? 'Private Office' : 'Conference Room'}</p>
                                </div>
                                <span className={`text-xs font-semibold ${available ? 'text-green-600' : 'text-red-500'}`}>
                                  {available ? 'Available' : 'Full'}
                                </span>
                              </div>
                              {roomBookings.length > 0 && (
                                <div className="px-4 py-2 space-y-1">
                                  {roomBookings.map((b:any) => (
                                    <div key={b.id} className="flex items-center justify-between text-xs py-1">
                                      <span className="text-gray-600 font-medium">{fmtSlot(b.start_time)}</span>
                                      <span className="text-gray-400">{b.profiles?.full_name}</span>
                                      <button onClick={async () => {
                                        if (!confirm('Cancel this booking?')) return
                                        // Server-side: deleting another member's
                                        // booking from the browser was filtered
                                        // by RLS to zero rows and "succeeded".
                                        const res = await fetch('/api/admin/bookings', {
                                          method: 'DELETE',
                                          headers: await authHeaders(),
                                          body: JSON.stringify({ id: b.id }),
                                        })
                                        if (!res.ok) {
                                          const { error } = await res.json().catch(() => ({ error: null }))
                                          alert(error || 'Could not cancel the booking')
                                          return
                                        }
                                        setAllBookings((prev:any) => prev.filter((x:any) => x.id !== b.id))
                                      }} className="text-red-400 font-medium">Cancel</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Book on behalf of member */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-bt-navy">Book on Behalf of Member</h3>
                <select value={adminBookUserId} onChange={e => setAdminBookUserId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bt-blue">
                  <option value="">Select member...</option>
                  {users.map((u:any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
                <select value={adminBookRoomId} onChange={e => setAdminBookRoomId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bt-blue">
                  <option value="">Select room...</option>
                  {rooms.map((r:any) => <option key={r.id} value={r.id}>{r.name} · {r.suite}</option>)}
                </select>
                <input type="date" value={adminBookDate} min={todayStr}
                  onChange={e => setAdminBookDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue" />
                <select value={adminBookTime} onChange={e => setAdminBookTime(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bt-blue">
                  <option value="">Select time...</option>
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{fmtSlot(t)}</option>)}
                </select>
                <button
                  disabled={!adminBookUserId || !adminBookRoomId || !adminBookDate || !adminBookTime || adminBooking}
                  onClick={async () => {
                    setAdminBooking(true)
                    const [h] = adminBookTime.split(':').map(Number)
                    // Server-side: inserting a row for another member from the
                    // browser is blocked by RLS while the UI reported success.
                    const res = await fetch('/api/admin/bookings', {
                      method: 'POST',
                      headers: await authHeaders(),
                      body: JSON.stringify({
                        room_id: adminBookRoomId,
                        user_id: adminBookUserId,
                        booking_date: adminBookDate,
                        start_time: adminBookTime,
                        end_time: `${String(h+1).padStart(2,'0')}:00`,
                      }),
                    })
                    setAdminBooking(false)
                    if (!res.ok) {
                      const { error } = await res.json().catch(() => ({ error: null }))
                      alert(error || 'Could not add the booking')
                      return
                    }
                    setAdminBookUserId(''); setAdminBookRoomId(''); setAdminBookTime('')
                    loadRooms()
                    alert('Booking added!')
                  }}
                  className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                  {adminBooking ? 'Booking...' : 'Add Booking'}
                </button>
              </div>

            </div>
          )
        })()}

        {/* MEETINGS TAB */}
        {tab === 'meetings' && (
          <div className="space-y-4">
            {!selectedMeeting ? (
              <>
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <h3 className="font-bold text-bt-navy mb-1">Meeting Plans</h3>
                  <p className="text-xs text-gray-400 mb-4">Full curriculum for each BT table meeting.</p>
                  <div className="space-y-2">
                    {MEETING_PLANS.map(m => (
                      <button key={m.number} onClick={() => setSelectedMeeting(m)}
                        className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-bt-pale hover:bg-bt-light/30 transition-colors text-left">
                        <div>
                          <span className="text-xs font-bold text-bt-blue uppercase tracking-wider">Meeting #{m.number}</span>
                          <p className="font-semibold text-gray-900 text-sm mt-0.5">{m.title}</p>
                        </div>
                        <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <button onClick={() => setSelectedMeeting(null)}
                  className="flex items-center gap-2 text-sm font-medium text-bt-blue">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  All Meetings
                </button>

                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <p className="text-xs font-bold text-bt-blue uppercase tracking-wider">Meeting #{selectedMeeting.number}</p>
                  <h2 className="text-xl font-bold text-bt-navy mt-1">{selectedMeeting.title}</h2>
                </div>

                {selectedMeeting.resources.length > 0 && (
                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <h4 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
                      <span className="text-lg">📎</span> Resources & Handouts
                    </h4>
                    <ul className="space-y-2">
                      {selectedMeeting.resources.map((r, i) => (
                        <li key={i} className="text-sm text-gray-600 flex gap-2">
                          <span className="text-gray-300 flex-shrink-0 mt-0.5">•</span>
                          <span>{r.includes('https://') ? (
                            <>
                              {r.split('https://')[0].replace(/:\s*$/, '')}
                              {' '}
                              <a href={'https://' + r.split('https://')[1]} target="_blank" rel="noopener noreferrer"
                                className="text-bt-blue underline break-all">link</a>
                            </>
                          ) : r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedMeeting.foundations.length > 0 && (
                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <h4 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
                      <span className="text-lg">🔁</span> Recap & BT Foundations
                    </h4>
                    <ul className="space-y-2">
                      {selectedMeeting.foundations.map((f, i) => (
                        <li key={i} className="text-sm text-gray-600 flex gap-2">
                          <span className="text-gray-300 flex-shrink-0 mt-0.5">•</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedMeeting.curriculum.length > 0 && (
                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <h4 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
                      <span className="text-lg">📋</span> Curriculum
                    </h4>
                    <ul className="space-y-2">
                      {selectedMeeting.curriculum.map((c, i) => (
                        <li key={i} className="text-sm text-gray-600 flex gap-2">
                          <span className="text-gray-300 flex-shrink-0 mt-0.5">•</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedMeeting.challenges.length > 0 && (
                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <h4 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
                      <span className="text-lg">🎯</span> Challenges
                    </h4>
                    <ul className="space-y-2">
                      {selectedMeeting.challenges.map((ch, i) => (
                        <li key={i} className="text-sm text-gray-600 flex gap-2">
                          <span className="text-gray-300 flex-shrink-0 mt-0.5">•</span>
                          <span>{ch}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex gap-3">
                  {selectedMeeting.number > 0 && (
                    <button onClick={() => setSelectedMeeting(MEETING_PLANS[selectedMeeting.number - 1])}
                      className="flex-1 bg-white border border-gray-200 text-bt-navy py-3 rounded-xl font-semibold text-sm">
                      ← Meeting #{selectedMeeting.number - 1}
                    </button>
                  )}
                  {selectedMeeting.number < MEETING_PLANS.length - 1 && (
                    <button onClick={() => setSelectedMeeting(MEETING_PLANS[selectedMeeting.number + 1])}
                      className="flex-1 bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm">
                      Meeting #{selectedMeeting.number + 1} →
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

      </div>
      <BottomNav />
    </div>
  )
}
