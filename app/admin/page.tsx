'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

type Tab = 'tasks' | 'content' | 'prompts' | 'groups' | 'members' | 'scores' | 'notifications' | 'events' | 'rooms'

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
  const [assignUserId, setAssignUserId] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [copiedGroupId, setCopiedGroupId] = useState('')
  const [contentError, setContentError] = useState('')
  const [contentSaving, setContentSaving] = useState(false)
  const [memberFilter, setMemberFilter] = useState('all')
  const [prompts, setPrompts] = useState<any[]>([])
  const [promptText, setPromptText] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)

  // Notification settings state
  const [notifSettings, setNotifSettings] = useState<any>(null)
  const [checkinEnabled, setCheckinEnabled] = useState(true)
  const [checkinTime, setCheckinTime] = useState('20:00')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderMessage, setReminderMessage] = useState('')
  const [reminderTime, setReminderTime] = useState('12:00')
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifSaved, setNotifSaved] = useState(false)
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

  // Rooms state
  const [rooms, setRooms] = useState<any[]>([])
  const [allBookings, setAllBookings] = useState<any[]>([])
  const [roomName, setRoomName] = useState('')
  const [roomDesc, setRoomDesc] = useState('')
  const [roomCapacity, setRoomCapacity] = useState('')
  const [roomSaving, setRoomSaving] = useState(false)
  const [adminBookDate, setAdminBookDate] = useState(new Date().toISOString().split('T')[0])
  const [adminBookUserId, setAdminBookUserId] = useState('')
  const [adminBookRoomId, setAdminBookRoomId] = useState('')
  const [adminBookTime, setAdminBookTime] = useState('')
  const [adminBooking, setAdminBooking] = useState(false)

  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (prof?.role !== 'leader') { router.push('/dashboard'); return }

      const membersReq = await fetch('/api/admin/members')
      const membersRes = await membersReq.json()
      console.log('Admin members API response:', membersReq.status, membersRes)

      const groupsRes = await supabase.from('groups').select('*, last_period_start')
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
      supabase.from('group_notification_settings').select('*').eq('group_id', gid).single(),
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
    await supabase.from('group_notification_settings').upsert({
      group_id: selectedGroup,
      checkin_enabled: checkinEnabled,
      checkin_time: checkinTime,
      checkin_timezone: timezone,
      reminder_enabled: reminderEnabled,
      reminder_message: reminderMessage.trim(),
      reminder_time: reminderTime,
    }, { onConflict: 'group_id' })
    setNotifSaving(false)
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
    setBroadcastSent(true)
    setBroadcastMessage('')
    setTimeout(() => setBroadcastSent(false), 3000)
    alert(`Broadcast sent to ${result.sent} member${result.sent !== 1 ? 's' : ''}!`)
  }

  async function loadEvents() {
    const supabase = createClient()
    const { data } = await supabase.from('events').select('*').order('event_date', { ascending: true })
    setEvents(data || [])
  }

  async function addEvent() {
    if (!eventTitle.trim() || !eventDate) return
    setEventSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('events').insert({
      title: eventTitle.trim(),
      description: eventDesc.trim() || null,
      event_date: eventDate,
      event_type: eventType,
      location: eventType === 'in_person' ? eventLocation.trim() || null : null,
      virtual_link: eventType === 'virtual' ? eventLink.trim() || null : null,
      created_by: user!.id,
    })
    setEventTitle(''); setEventDesc(''); setEventDate(''); setEventLocation(''); setEventLink('')
    setEventSaving(false)
    loadEvents()
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
        .gte('booking_date', new Date().toISOString().split('T')[0])
        .order('booking_date', { ascending: true }),
    ])
    setRooms(r || [])
    setAllBookings(b || [])
  }

  async function addRoom() {
    if (!roomName.trim()) return
    setRoomSaving(true)
    const supabase = createClient()
    await supabase.from('rooms').insert({
      name: roomName.trim(),
      description: roomDesc.trim() || null,
      capacity: roomCapacity ? parseInt(roomCapacity) : null,
    })
    setRoomName(''); setRoomDesc(''); setRoomCapacity('')
    setRoomSaving(false)
    loadRooms()
  }

  async function deleteRoom(id: string) {
    if (!confirm('Delete this room and all its bookings?')) return
    const supabase = createClient()
    await supabase.from('rooms').delete().eq('id', id)
    loadRooms()
  }

  async function startNewPeriod() {
    if (!selectedGroup || !periodLabel.trim()) return
    if (!confirm(`Archive all current tasks and start period "${periodLabel}"?`)) return
    setArchiving(true)
    const supabase = createClient()

    // Archive existing tasks
    await supabase.from('tasks').update({ archived: true }).eq('group_id', selectedGroup).eq('archived', false)

    // Record when this period started
    await supabase.from('groups').update({ last_period_start: new Date().toISOString() }).eq('id', selectedGroup)

    // Reset streak for anyone who didn't hit 100% this period
    await supabase.from('profiles').update({ streak: 0 })
      .eq('group_id', selectedGroup)
      .lt('adherence_percent', 100)

    // Reset adherence for all group members
    await supabase.from('profiles').update({ adherence_percent: 0 }).eq('group_id', selectedGroup)

    setTasks([])
    setPeriodLabel('')
    setArchiving(false)
    alert(`New period "${periodLabel}" started. Add new tasks below.`)
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

  async function assignUser() {
    if (!assignUserId || !selectedGroup) return
    const supabase = createClient()
    await supabase.from('profiles').update({ group_id: selectedGroup }).eq('id', assignUserId)
    setUsers(p => p.map(u => u.id === assignUserId ? { ...u, group_id: selectedGroup } : u))
    setAssignUserId('')
  }

  async function assignUserToGroup(userId: string, groupId: string) {
    const val = groupId === '' ? null : groupId
    await fetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, groupId: val })
    })
    setUsers(p => p.map(u => u.id === userId ? { ...u, group_id: val } : u))
  }

  async function deleteMember(userId: string, name: string) {
    if (!confirm(`Remove ${name} from the app? This cannot be undone.`)) return
    await fetch('/api/admin/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    })
    setUsers(p => p.filter(u => u.id !== userId))
  }

  async function toggleLeader(userId: string, currentRole: string) {
    const newRole = currentRole === 'leader' ? 'participant' : 'leader'
    if (!confirm(`${newRole === 'leader' ? 'Promote to leader' : 'Demote to participant'}?`)) return
    await fetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: newRole })
    })
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
            onChange={e => { setSelectedGroup(e.target.value); loadGroupData(e.target.value) }}
            className="mt-3 w-full bg-white/15 text-white text-sm rounded-xl px-3 py-2 border border-white/25 focus:outline-none">
            {groups.map(g => <option key={g.id} value={g.id} className="text-gray-900">{g.name}</option>)}
          </select>
        )}
        <div className="flex gap-2 mt-4 pb-1 overflow-x-auto">
          {(['tasks', 'content', 'prompts', 'groups', 'members', 'scores', 'notifications', 'events', 'rooms'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); if (t === 'events') loadEvents(); if (t === 'rooms') loadRooms(); }}
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
                <div key={task.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 text-sm">{task.title}</p>
                    {task.description && <p className="text-gray-400 text-xs mt-0.5">{task.description}</p>}
                  </div>
                  <button onClick={() => deleteTask(task.id)} className="text-red-400 text-sm font-medium px-2 py-1">Remove</button>
                </div>
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
                <div key={item.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 text-sm">{item.title}</p>
                    <p className="text-gray-400 text-xs mt-0.5 capitalize">{item.type}</p>
                  </div>
                  <button onClick={async () => {
                    if (!confirm(`Remove "${item.title}"?`)) return
                    const supabase = createClient()
                    await supabase.from('content').delete().eq('id', item.id)
                    setContent(p => p.filter(c => c.id !== item.id))
                  }} className="text-red-400 text-sm font-medium px-2 py-1">Remove</button>
                </div>
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
            <div className="space-y-2">
              {prompts.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">No prompts yet. Post one above.</p>
              )}
              {prompts.map((p: any) => (
                <div key={p.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 leading-snug">{p.prompt}</p>
                    <p className="text-gray-400 text-xs mt-1">{new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                  </div>
                  <button onClick={async () => {
                    if (!confirm('Delete this prompt?')) return
                    const supabase = createClient()
                    await supabase.from('journal_prompts').delete().eq('id', p.id)
                    setPrompts(prev => prev.filter(x => x.id !== p.id))
                  }} className="text-red-400 text-sm font-medium px-2 py-1 flex-shrink-0">Remove</button>
                </div>
              ))}
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
                const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join?group=${g.id}`
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
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(inviteLink)
                        setCopiedGroupId(g.id)
                        setTimeout(() => setCopiedGroupId(''), 2500)
                      }}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold border-2 border-bt-blue text-bt-blue transition-colors">
                      {copied ? '✓ Copied!' : 'Copy Invite Link'}
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {tab === 'members' && (
          <div className="space-y-3">
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
              className="w-full bg-bt-navy text-white py-4 rounded-2xl font-semibold disabled:opacity-50">
              {notifSaving ? 'Saving...' : notifSaved ? '✓ Saved!' : 'Save Notification Settings'}
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
                  <button onClick={() => deleteEvent(event.id)} className="text-red-400 text-xs font-medium flex-shrink-0">Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'rooms' && (() => {
          const TIME_SLOTS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00']
          function fmtSlot(t: string) { const [h,m] = t.split(':').map(Number); return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}` }
          function fmtDate(d: string) { return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) }
          const [adminDate, setAdminDate] = [adminBookDate, setAdminBookDate] as any
          const todayStr = new Date().toISOString().split('T')[0]
          const dayBookings = allBookings.filter((b:any) => b.booking_date === adminBookDate)
          const suites = ['Suite 1','Suite 2']

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
                                        const supabase = createClient()
                                        await supabase.from('room_bookings').delete().eq('id', b.id)
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
                    const supabase = createClient()
                    const [h] = adminBookTime.split(':').map(Number)
                    await supabase.from('room_bookings').insert({
                      room_id: adminBookRoomId,
                      user_id: adminBookUserId,
                      booking_date: adminBookDate,
                      start_time: adminBookTime,
                      end_time: `${String(h+1).padStart(2,'0')}:00`,
                    })
                    setAdminBookUserId(''); setAdminBookRoomId(''); setAdminBookTime('')
                    setAdminBooking(false)
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

      </div>
      <BottomNav />
    </div>
  )
}
