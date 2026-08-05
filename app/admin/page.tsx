'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import {
  MEETING_SECTIONS,
  resolveMeetingPlans,
  type StoredMeetingPlan,
} from '@/lib/meeting-plans'
import { localDay } from '@/lib/dates'
import {
  DEFAULT_SETTINGS,
  durationOptions,
  formatDuration,
  formatTime,
  hoursForDate,
  maxDurationAt,
  parseTime,
  slotsForDate,
  toIntervals,
  toTimeString,
  type VenueHours,
  type VenueSettings,
} from '@/lib/venue'

import { ledGroups } from '@/lib/leader-groups'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type Tab = 'tasks' | 'content' | 'prompts' | 'groups' | 'members' | 'scores' | 'notifications' | 'events' | 'rooms' | 'meetings' | 'sessions'

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

  // Meetings state. Defaults and this table's overrides are held separately so
  // the editor can always say which of the two you are about to change.
  const [meetingDefaults, setMeetingDefaults] = useState<StoredMeetingPlan[]>([])
  const [meetingOverrides, setMeetingOverrides] = useState<StoredMeetingPlan[]>([])
  const [selectedMeetingNumber, setSelectedMeetingNumber] = useState<number | null>(null)
  const [meetingScope, setMeetingScope] = useState<'default' | 'table'>('table')
  const [meetingDraft, setMeetingDraft] = useState<Record<string, string> | null>(null)
  const [meetingSaving, setMeetingSaving] = useState(false)
  const [meetingError, setMeetingError] = useState('')
  const [meetingsLoading, setMeetingsLoading] = useState(false)

  // Alumni / drop-in sign-ups. Not group-scoped — see the sessions page.
  const [sessions, setSessions] = useState<any[]>([])
  const [registrations, setRegistrations] = useState<any[]>([])
  const [sessionKind, setSessionKind] = useState<'alumni' | 'dropin'>('dropin')
  const [sessionTitle, setSessionTitle] = useState('')
  const [sessionDate, setSessionDate] = useState('')
  const [sessionLocation, setSessionLocation] = useState('')
  const [sessionDesc, setSessionDesc] = useState('')
  const [sessionCapacity, setSessionCapacity] = useState('')
  const [sessionSaving, setSessionSaving] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [openRoster, setOpenRoster] = useState<string | null>(null)

  // Rooms state
  const [rooms, setRooms] = useState<any[]>([])
  const [allBookings, setAllBookings] = useState<any[]>([])
  const [adminBookDate, setAdminBookDate] = useState(localDay())
  const [adminBookUserId, setAdminBookUserId] = useState('')
  const [adminBookRoomId, setAdminBookRoomId] = useState('')
  const [adminBookTime, setAdminBookTime] = useState('')
  const [adminBookDuration, setAdminBookDuration] = useState(0)
  const [adminBooking, setAdminBooking] = useState(false)

  // Co-leaders. groups.leader_id is a single uuid, so before 2026-08-03 a TC
  // who was away froze their whole table — nobody else could roll the period,
  // edit the outline or broadcast.
  const [groupLeaders, setGroupLeaders] = useState<Record<string, any[]>>({})
  const [leaderPick, setLeaderPick] = useState<Record<string, string>>({})
  const [leaderBusy, setLeaderBusy] = useState('')
  const [leaderError, setLeaderError] = useState('')

  // Venue hours, booking rules and room management. All of this used to be
  // hardcoded in this file and app/booking/page.tsx; it moved into the database
  // when the app took over from Skedda as the venue's real schedule.
  const [venueHours, setVenueHours] = useState<VenueHours[]>([])
  const [venueSettings, setVenueSettings] = useState<VenueSettings>(DEFAULT_SETTINGS)
  const [venueSaving, setVenueSaving] = useState(false)
  const [venueError, setVenueError] = useState('')
  const [venueSaved, setVenueSaved] = useState(false)
  const [roomError, setRoomError] = useState('')
  const [editingRoom, setEditingRoom] = useState<any>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [roomSaving, setRoomSaving] = useState(false)
  const emptyRoom = { name: '', suite: '', room_type: 'conference_room', capacity: '', description: '' }
  const [newRoom, setNewRoom] = useState<any>(emptyRoom)

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
      // table the panel could silently open on someone else's group. Includes
      // tables they co-lead, not only ones they are named on.
      const grps = await ledGroups(supabase, user.id, '*, last_period_start')
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

  // --- Meeting plans -------------------------------------------------------

  async function loadMeetingPlans(gid: string = selectedGroup) {
    setMeetingsLoading(true)
    setMeetingError('')
    const qs = gid ? `?group_id=${encodeURIComponent(gid)}` : ''
    const res = await fetch(`/api/admin/meeting-plans${qs}`, { headers: await authHeaders() })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMeetingError(json.error || `Could not load meeting plans (${res.status})`)
      setMeetingsLoading(false)
      return
    }

    // First run after the migration: the table is empty, so publish the
    // curriculum that has been living in the repo, then read it back.
    if ((json.defaults || []).length === 0) {
      const seed = await fetch('/api/admin/meeting-plans', {
        method: 'POST',
        headers: await authHeaders(),
      })
      if (seed.ok) {
        const again = await fetch(`/api/admin/meeting-plans${qs}`, { headers: await authHeaders() })
        const seeded = await again.json().catch(() => ({}))
        if (again.ok) {
          setMeetingDefaults(seeded.defaults || [])
          setMeetingOverrides(seeded.overrides || [])
          setMeetingsLoading(false)
          return
        }
      }
    }

    setMeetingDefaults(json.defaults || [])
    setMeetingOverrides(json.overrides || [])
    setMeetingsLoading(false)
  }

  /** What this table actually runs: its override if it has one, else the default. */
  function resolvedMeetings(): StoredMeetingPlan[] {
    return resolveMeetingPlans([...meetingDefaults, ...meetingOverrides])
  }

  function meetingFor(number: number, scope: 'default' | 'table'): StoredMeetingPlan | null {
    const pool = scope === 'default' ? meetingDefaults : meetingOverrides
    return pool.find(p => p.number === number) || null
  }

  /**
   * Opens the editor. Editing "for this table" with no override yet starts from
   * a copy of the default — the copy-on-write step that keeps one TC's rewrite
   * off every other table's outline.
   */
  function openMeetingEditor(number: number, scope: 'default' | 'table') {
    const source = meetingFor(number, scope) || meetingFor(number, 'default')
    if (!source) return
    setMeetingScope(scope)
    setSelectedMeetingNumber(number)
    setMeetingError('')
    setMeetingDraft({
      title: source.title,
      ...Object.fromEntries(
        MEETING_SECTIONS.map(s => [s.key, (source[s.key] || []).join('\n')])
      ),
    })
  }

  async function saveMeetingPlan() {
    if (selectedMeetingNumber === null || !meetingDraft) return
    if (!meetingDraft.title.trim()) { setMeetingError('Title is required'); return }
    if (meetingScope === 'table' && !selectedGroup) {
      setMeetingError('Pick a table first')
      return
    }
    setMeetingSaving(true)
    setMeetingError('')

    const res = await fetch('/api/admin/meeting-plans', {
      method: 'PUT',
      headers: await authHeaders(),
      body: JSON.stringify({
        group_id: meetingScope === 'table' ? selectedGroup : null,
        number: selectedMeetingNumber,
        title: meetingDraft.title,
        // One bullet per line — reordering is moving a line, which beats
        // building drag handles for a list edited a few times a year.
        ...Object.fromEntries(
          MEETING_SECTIONS.map(s => [s.key, (meetingDraft[s.key] || '').split('\n')])
        ),
      }),
    })
    const json = await res.json().catch(() => ({}))
    setMeetingSaving(false)
    if (!res.ok) {
      setMeetingError(json.detail || json.error || `Save failed (${res.status})`)
      return
    }
    setMeetingDraft(null)
    await loadMeetingPlans()
  }

  async function resetMeetingOverride(number: number) {
    if (!selectedGroup) return
    if (!confirm(`Reset meeting #${number} for this table back to the BT default? Your table's edits to it will be lost.`)) return
    const res = await fetch(
      `/api/admin/meeting-plans?group_id=${encodeURIComponent(selectedGroup)}&number=${number}`,
      { method: 'DELETE', headers: await authHeaders() }
    )
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setMeetingError(json.error || `Reset failed (${res.status})`); return }
    setMeetingDraft(null)
    await loadMeetingPlans()
  }

  async function setCurrentMeeting(number: number | null) {
    if (!selectedGroup) return
    const res = await fetch('/api/admin/meeting-plans', {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify({ group_id: selectedGroup, current_meeting_number: number }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setMeetingError(json.error || `Could not update (${res.status})`); return }
    setGroups(g => g.map(x => x.id === selectedGroup ? { ...x, current_meeting_number: number } : x))
  }

  // --- Alumni / drop-in sessions ------------------------------------------

  async function loadSessions() {
    const supabase = createClient()
    const [s, r] = await Promise.all([
      supabase.from('signup_sessions').select('*').order('session_date', { ascending: true }),
      supabase.from('signup_registrations').select('*, profiles(full_name, contact_email)'),
    ])
    if (s.error) { setSessionError(s.error.message); return }
    if (r.error) console.error('registrations fetch failed:', r.error.message)
    setSessions(s.data || [])
    setRegistrations(r.data || [])
  }

  async function addSession() {
    if (!sessionTitle.trim() || !sessionDate) return
    setSessionSaving(true)
    setSessionError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const capacity = sessionCapacity.trim() === '' ? null : Number(sessionCapacity)
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
      setSessionSaving(false)
      setSessionError('Capacity must be a whole number, or blank for no limit')
      return
    }

    const { error } = await supabase.from('signup_sessions').insert({
      kind: sessionKind,
      title: sessionTitle.trim(),
      // datetime-local carries no offset, so Postgres would read it as UTC and
      // show everyone the wrong hour — the same bug events had.
      session_date: new Date(sessionDate).toISOString(),
      location: sessionLocation.trim() || null,
      description: sessionDesc.trim() || null,
      capacity,
      created_by: user!.id,
    })
    setSessionSaving(false)
    if (error) { setSessionError(error.message); return }
    setSessionTitle(''); setSessionDate(''); setSessionLocation(''); setSessionDesc(''); setSessionCapacity('')
    loadSessions()
  }

  async function toggleSessionOpen(session: any) {
    const supabase = createClient()
    const { error } = await supabase
      .from('signup_sessions')
      .update({ open: !session.open })
      .eq('id', session.id)
    if (error) { setSessionError(error.message); return }
    setSessions(p => p.map(s => s.id === session.id ? { ...s, open: !session.open } : s))
  }

  async function deleteSession(id: string) {
    if (!confirm('Delete this session? Everyone signed up for it will be removed too.')) return
    const supabase = createClient()
    const { error } = await supabase.from('signup_sessions').delete().eq('id', id)
    if (error) { setSessionError(error.message); return }
    setSessions(p => p.filter(s => s.id !== id))
    setRegistrations(p => p.filter(r => r.session_id !== id))
  }

  async function removeRegistration(id: string) {
    const supabase = createClient()
    const { error } = await supabase.from('signup_registrations').delete().eq('id', id)
    if (error) { setSessionError(error.message); return }
    setRegistrations(p => p.filter(r => r.id !== id))
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
      // A raw datetime-local string has no offset, so Postgres treated it as
      // UTC and every viewer saw the wrong hour. Convert to a real instant in
      // the leader's timezone at save time.
      event_date: new Date(eventDate).toISOString(),
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
    // The event date input holds a local datetime-local string; store it as a
    // real UTC instant, same as addEvent.
    const payload = editing.table === 'events' && editing.fields.event_date
      ? { ...editing, fields: { ...editing.fields, event_date: new Date(editing.fields.event_date).toISOString() } }
      : editing
    const res = await fetch('/api/admin/edit-item', {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify(payload),
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

  // A stored instant rendered back into the leader's local wall-clock time for
  // a datetime-local input (which understands no offsets).
  function toLocalInput(d: string): string {
    const date = new Date(d)
    if (isNaN(date.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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

  /** Leaders for every table shown, so each card can list its own. */
  async function loadGroupLeaders(groupIds: string[]) {
    const headers = await authHeaders()
    const entries = await Promise.all(groupIds.map(async gid => {
      const res = await fetch(`/api/admin/group-leaders?group_id=${gid}`, { headers })
      if (!res.ok) return [gid, []] as const
      const { leaders } = await res.json().catch(() => ({ leaders: [] }))
      return [gid, leaders || []] as const
    }))
    setGroupLeaders(Object.fromEntries(entries))
  }

  async function changeLeaders(
    method: 'POST' | 'PATCH' | 'DELETE',
    groupId: string,
    userId: string
  ) {
    setLeaderBusy(`${groupId}:${userId}`)
    setLeaderError('')
    const res = await fetch('/api/admin/group-leaders', {
      method,
      headers: await authHeaders(),
      body: JSON.stringify({ group_id: groupId, user_id: userId }),
    })
    setLeaderBusy('')
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      setLeaderError(error || 'Could not update the table leaders')
      return
    }
    const { leaders } = await res.json()
    setGroupLeaders(prev => ({ ...prev, [groupId]: leaders || [] }))
    setLeaderPick(prev => ({ ...prev, [groupId]: '' }))
  }

  async function loadRooms() {
    const supabase = createClient()
    const headers = await authHeaders()
    const [{ data: b }, roomsRes, venueRes] = await Promise.all([
      supabase.from('room_bookings')
        .select('*, rooms(name), profiles(full_name)')
        .gte('booking_date', localDay())
        .order('booking_date', { ascending: true }),
      // Read through the API rather than the browser client so archived rooms
      // come back too — a room you cannot see is a room you cannot un-archive.
      fetch('/api/admin/rooms', { headers }),
      fetch('/api/admin/venue', { headers }),
    ])

    const roomsJson = await roomsRes.json().catch(() => ({ rooms: [] }))
    // A room with no group_id (or from before the column existed) is shared
    // across tables; a stamped room belongs to one table only.
    setRooms((roomsJson.rooms || []).filter((room: any) => !room.group_id || room.group_id === selectedGroup))
    setAllBookings(b || [])

    const venueJson = await venueRes.json().catch(() => ({}))
    if (venueJson.hours) setVenueHours(venueJson.hours)
    if (venueJson.settings) setVenueSettings(venueJson.settings)
  }

  async function saveVenue(patch: { hours?: VenueHours[]; settings?: Partial<VenueSettings> }) {
    setVenueSaving(true)
    setVenueError('')
    const res = await fetch('/api/admin/venue', {
      method: 'PUT',
      headers: await authHeaders(),
      body: JSON.stringify(patch),
    })
    setVenueSaving(false)
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      setVenueError(error || 'Could not save venue settings')
      return false
    }
    const json = await res.json()
    // Re-read from the response rather than trusting local state: the server
    // normalises times and rejects combinations the form would happily submit.
    if (json.hours) setVenueHours(json.hours)
    if (json.settings) setVenueSettings(json.settings)
    setVenueSaved(true)
    setTimeout(() => setVenueSaved(false), 2500)
    return true
  }

  async function saveRoom(room: any, isNew: boolean) {
    setRoomSaving(true)
    setRoomError('')
    const payload: any = {
      name: room.name,
      suite: room.suite,
      room_type: room.room_type,
      capacity: room.capacity === '' ? null : Number(room.capacity),
      description: room.description || null,
    }
    if (!isNew) payload.id = room.id

    const res = await fetch('/api/admin/rooms', {
      method: isNew ? 'POST' : 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify(payload),
    })
    setRoomSaving(false)
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      setRoomError(error || 'Could not save the room')
      return
    }
    if (isNew) setNewRoom(emptyRoom)
    setEditingRoom(null)
    loadRooms()
  }

  async function setRoomActive(room: any, active: boolean) {
    setRoomError('')
    if (active) {
      const res = await fetch('/api/admin/rooms', {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({ id: room.id, is_active: true }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }))
        setRoomError(error || 'Could not restore the room')
        return
      }
      loadRooms()
      return
    }

    if (!confirm(`Archive ${room.name}? It disappears from booking but keeps its history.`)) return
    const res = await fetch('/api/admin/rooms', {
      method: 'DELETE',
      headers: await authHeaders(),
      body: JSON.stringify({ id: room.id }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      setRoomError(error || 'Could not archive the room')
      return
    }
    // Upcoming bookings are not cancelled automatically — someone is expecting
    // that room, and the leader is the one who should tell them.
    const { upcoming_bookings } = await res.json().catch(() => ({ upcoming_bookings: 0 }))
    if (upcoming_bookings > 0) {
      alert(
        `${room.name} is archived, but it still has ${upcoming_bookings} upcoming booking` +
        `${upcoming_bookings === 1 ? '' : 's'}. Those members have not been told — cancel them from the dashboard above if the room is really gone.`
      )
    }
    loadRooms()
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
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-white text-2xl font-bold">Admin Panel</h1>
          {/* A separate route rather than a twelfth tab: it reads from Cause
              Machine, not from our own tables, and it is slow enough (eight paged
              API calls) that it should not load behind a tab click. */}
          <Link href="/admin/finances"
            className="text-bt-light/80 text-sm font-medium bg-white/15 border border-white/25 rounded-xl px-3 py-1.5 whitespace-nowrap">
            Finances →
          </Link>
        </div>
        {groups.length > 0 && (
          <select value={selectedGroup}
            onChange={e => {
              const gid = e.target.value
              setSelectedGroup(gid)
              loadGroupData(gid)
              setJournalResponses(null)
              if (tab === 'events') loadEvents(gid)
              if (tab === 'meetings') { setSelectedMeetingNumber(null); setMeetingDraft(null); loadMeetingPlans(gid) }
            }}
            className="mt-3 w-full bg-white/15 text-white text-sm rounded-xl px-3 py-2 border border-white/25 focus:outline-none">
            {groups.map(g => <option key={g.id} value={g.id} className="text-gray-900">{g.name}</option>)}
          </select>
        )}
        <div className="flex gap-2 mt-4 pb-1 overflow-x-auto">
          {(['tasks', 'content', 'prompts', 'groups', 'members', 'scores', 'notifications', 'events', 'rooms', 'meetings', 'sessions'] as Tab[]).map(t => (
            <button key={t} onClick={() => {
              setTab(t)
              if (t === 'events') loadEvents()
              if (t === 'rooms') loadRooms()
              if (t === 'sessions') loadSessions()
              if (t === 'meetings') { setSelectedMeetingNumber(null); setMeetingDraft(null); loadMeetingPlans() }
              if (t === 'prompts' && selectedGroup) loadJournalResponses(selectedGroup)
              if (t === 'groups') {
                groups.forEach(g => { if (!inviteLinks[g.id]) loadInviteLink(g.id) })
                loadGroupLeaders(groups.map(g => g.id))
              }
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
                    {/* Table leaders. Co-leaders have identical powers; "Main TC"
                        is a label for attribution, not a permission level. */}
                    <div className="bg-bt-pale rounded-xl p-3 space-y-2">
                      <p className="text-xs text-gray-400 font-medium">Table Leaders</p>
                      {(groupLeaders[g.id] || []).map((l: any) => (
                        <div key={l.user_id} className="flex items-center gap-2">
                          <span className="text-xs text-gray-700 font-medium flex-1 truncate">
                            {l.profiles?.full_name || 'Unnamed'}
                          </span>
                          {l.is_primary ? (
                            <span className="text-[10px] font-bold text-bt-blue uppercase tracking-wide flex-shrink-0">Main TC</span>
                          ) : (
                            <>
                              <button
                                disabled={leaderBusy === `${g.id}:${l.user_id}`}
                                onClick={() => changeLeaders('PATCH', g.id, l.user_id)}
                                className="text-[11px] text-bt-blue font-medium flex-shrink-0 disabled:opacity-40">
                                Make main
                              </button>
                              <button
                                disabled={leaderBusy === `${g.id}:${l.user_id}`}
                                onClick={() => changeLeaders('DELETE', g.id, l.user_id)}
                                className="text-[11px] text-red-400 font-medium flex-shrink-0 disabled:opacity-40">
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      ))}

                      {(groupLeaders[g.id] || []).length === 1 && (
                        <p className="text-[11px] text-amber-600 leading-relaxed">
                          Only one leader. If they&apos;re away, nobody can run this table.
                        </p>
                      )}

                      <div className="flex gap-2 pt-1">
                        <select
                          value={leaderPick[g.id] || ''}
                          onChange={e => setLeaderPick(prev => ({ ...prev, [g.id]: e.target.value }))}
                          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white">
                          <option value="">Add a co-leader...</option>
                          {users
                            .filter((u: any) => u.group_id === g.id)
                            .filter((u: any) => !(groupLeaders[g.id] || []).some((l: any) => l.user_id === u.id))
                            .map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                        </select>
                        <button
                          disabled={!leaderPick[g.id] || leaderBusy.startsWith(`${g.id}:`)}
                          onClick={() => changeLeaders('POST', g.id, leaderPick[g.id])}
                          className="px-3 py-1.5 rounded-lg bg-bt-navy text-white text-xs font-semibold disabled:opacity-40 flex-shrink-0">
                          Add
                        </button>
                      </div>
                      {leaderError && <p className="text-[11px] text-red-600 font-medium">{leaderError}</p>}
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
                    <input type="datetime-local" value={editing.fields.event_date || ''}
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
                    <div className="pt-2 border-t border-gray-100 space-y-2">
                      <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                        <input type="checkbox" checked={editing.fields.notifications_enabled !== false}
                          onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, notifications_enabled: e.target.checked } }))} />
                        Send notifications for this event
                      </label>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        Announced once when added, a reminder the day before and an hour ahead to
                        anyone who RSVPed, then a follow-up two hours after it starts.
                      </p>
                      <textarea value={editing.fields.followup_message || ''} rows={2}
                        onChange={e => setEditing(ed => ed && ({ ...ed, fields: { ...ed.fields, followup_message: e.target.value } }))}
                        className={`${inputClass} resize-none`} placeholder="Follow-up message (optional)" />
                    </div>
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
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {event.notifications_enabled === false ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wider bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          Notifications off
                        </span>
                      ) : (
                        <>
                          {event.announced_at && <NoticeChip label="Announced" />}
                          {event.reminder_24h_sent_at && <NoticeChip label="Day-before sent" />}
                          {event.reminder_1h_sent_at && <NoticeChip label="1h sent" />}
                          {event.followup_sent_at && <NoticeChip label="Followed up" />}
                        </>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setEditing({ table: 'events', id: event.id, fields: {
                    title: event.title, description: event.description || '', event_date: toLocalInput(event.event_date),
                    event_type: event.event_type, location: event.location || '', virtual_link: event.virtual_link || '',
                    notifications_enabled: event.notifications_enabled !== false,
                    followup_message: event.followup_message || '',
                  } })} className="text-bt-blue text-xs font-medium flex-shrink-0">Edit</button>
                  <button onClick={() => deleteEvent(event.id)} className="text-red-400 text-xs font-medium flex-shrink-0">Remove</button>
                </div>
                )
              ))}
            </div>
          </div>
        )}

        {tab === 'rooms' && (() => {
          const todayStr = localDay()
          const dayBookings = allBookings.filter((b:any) => b.booking_date === adminBookDate)
          // Derived from the rooms themselves rather than hardcoded. This read
          // ['Suite 1','Suite 2'] while the member booking page uses
          // ['Suite 145','Suite 120'], so every suite group matched nothing and
          // the whole dashboard rendered blank.
          const activeRooms = rooms.filter((r:any) => r.is_active !== false)
          const archivedRooms = rooms.filter((r:any) => r.is_active === false)
          const suites = Array.from(new Set(activeRooms.map((r: any) => r.suite).filter(Boolean)))
          const daySlots = slotsForDate(venueHours, venueSettings, adminBookDate)
          const dayHours = hoursForDate(venueHours, adminBookDate)
          const closed = !dayHours || dayHours.is_closed
          const bookRoom = rooms.find((r:any) => r.id === adminBookRoomId)
          const bookTaken = adminBookRoomId
            ? toIntervals(dayBookings.filter((b:any) => b.room_id === adminBookRoomId))
            : []
          const bookLongest = adminBookTime
            ? maxDurationAt(parseTime(adminBookTime), bookTaken, venueHours, venueSettings, adminBookDate)
            : 0
          const bookDurations = durationOptions(venueSettings).filter(d => d <= bookLongest)
          const bookChosen = adminBookDuration && adminBookDuration <= bookLongest ? adminBookDuration : bookDurations[0]

          return (
            <div className="space-y-5">

              {roomError && (
                <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
                  <p className="text-red-700 font-semibold text-sm text-center">{roomError}</p>
                </div>
              )}

              {/* Dashboard — pick a date, see all rooms */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-bt-navy">Room Dashboard</h3>
                  {closed && <span className="text-xs font-semibold text-amber-600">Venue closed</span>}
                </div>
                <input type="date" value={adminBookDate} min={todayStr}
                  onChange={async e => {
                    setAdminBookDate(e.target.value)
                    setAdminBookTime('')
                    const supabase = createClient()
                    const { data } = await supabase.from('room_bookings')
                      .select('*, rooms(name,suite), profiles(full_name)')
                      .eq('booking_date', e.target.value)
                      .order('start_time')
                    setAllBookings(data || [])
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue" />

                {suites.map(suite => {
                  const suiteRooms = activeRooms.filter(r => r.suite === suite)
                  if (!suiteRooms.length) return null
                  return (
                    <div key={suite}>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">{suite}</p>
                      <div className="space-y-2">
                        {suiteRooms.map(room => {
                          const roomBookings = dayBookings.filter((b:any) => b.room_id === room.id)
                          const taken = toIntervals(roomBookings)
                          // "Open" now means a bookable gap exists, not merely
                          // that no booking starts at a given hour — with
                          // variable lengths those are different questions.
                          const openStarts = daySlots.filter(s => maxDurationAt(s, taken, venueHours, venueSettings, adminBookDate) > 0)
                          const available = !closed && openStarts.length > 0
                          return (
                            <div key={room.id} className="rounded-xl border border-gray-100 overflow-hidden">
                              <div className="flex items-center gap-3 px-4 py-3 bg-bt-pale">
                                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${available ? 'bg-green-400' : 'bg-red-400'}`} />
                                <div className="flex-1">
                                  <p className="font-semibold text-sm text-gray-900">{room.name}</p>
                                  <p className="text-xs text-gray-400">{room.room_type === 'private_office' ? 'Private Office' : 'Conference Room'}</p>
                                </div>
                                <span className={`text-xs font-semibold ${available ? 'text-green-600' : 'text-red-500'}`}>
                                  {closed ? 'Closed' : available ? `${openStarts.length} open` : 'Full'}
                                </span>
                              </div>
                              {roomBookings.length > 0 && (
                                <div className="px-4 py-2 space-y-1">
                                  {roomBookings.map((b:any) => (
                                    <div key={b.id} className="flex items-center justify-between text-xs py-1">
                                      <span className="text-gray-600 font-medium">
                                        {formatTime(parseTime(b.start_time))} – {formatTime(parseTime(b.end_time))}
                                      </span>
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

                {!activeRooms.length && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    No rooms yet. Add the venue&apos;s real rooms below.
                  </p>
                )}
              </div>

              {/* Book on behalf of member */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-bt-navy">Book on Behalf of Member</h3>
                <select value={adminBookUserId} onChange={e => setAdminBookUserId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bt-blue">
                  <option value="">Select member...</option>
                  {users.map((u:any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
                <select value={adminBookRoomId} onChange={e => { setAdminBookRoomId(e.target.value); setAdminBookTime('') }}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bt-blue">
                  <option value="">Select room...</option>
                  {activeRooms.map((r:any) => <option key={r.id} value={r.id}>{r.name} · {r.suite}</option>)}
                </select>
                <input type="date" value={adminBookDate} min={todayStr}
                  onChange={e => { setAdminBookDate(e.target.value); setAdminBookTime('') }}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bt-blue" />
                <select value={adminBookTime} onChange={e => setAdminBookTime(e.target.value)}
                  disabled={!adminBookRoomId || closed}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bt-blue disabled:bg-gray-50 disabled:text-gray-400">
                  <option value="">{closed ? 'Venue closed that day' : !adminBookRoomId ? 'Pick a room first' : 'Select time...'}</option>
                  {daySlots
                    .filter(s => maxDurationAt(s, bookTaken, venueHours, venueSettings, adminBookDate) > 0)
                    .map(s => <option key={s} value={toTimeString(s)}>{formatTime(s)}</option>)}
                </select>
                {adminBookTime && bookDurations.length > 0 && (
                  <select value={String(bookChosen)} onChange={e => setAdminBookDuration(Number(e.target.value))}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bt-blue">
                    {bookDurations.map(d => <option key={d} value={d}>{formatDuration(d)}</option>)}
                  </select>
                )}
                <button
                  disabled={!adminBookUserId || !adminBookRoomId || !adminBookDate || !adminBookTime || !bookChosen || adminBooking}
                  onClick={async () => {
                    setAdminBooking(true)
                    const start = parseTime(adminBookTime)
                    // Server-side: inserting a row for another member from the
                    // browser is blocked by RLS while the UI reported success.
                    const res = await fetch('/api/admin/bookings', {
                      method: 'POST',
                      headers: await authHeaders(),
                      body: JSON.stringify({
                        room_id: adminBookRoomId,
                        user_id: adminBookUserId,
                        booking_date: adminBookDate,
                        start_time: toTimeString(start),
                        end_time: toTimeString(start + bookChosen),
                      }),
                    })
                    setAdminBooking(false)
                    if (!res.ok) {
                      const { error } = await res.json().catch(() => ({ error: null }))
                      alert(error || 'Could not add the booking')
                      return
                    }
                    setAdminBookUserId(''); setAdminBookRoomId(''); setAdminBookTime(''); setAdminBookDuration(0)
                    loadRooms()
                    alert('Booking added!')
                  }}
                  className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                  {adminBooking ? 'Booking...' : bookRoom && adminBookTime && bookChosen
                    ? `Book ${bookRoom.name} · ${formatTime(parseTime(adminBookTime))} – ${formatTime(parseTime(adminBookTime) + bookChosen)}`
                    : 'Add Booking'}
                </button>
              </div>

              {/* Manage rooms */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
                <h3 className="font-bold text-bt-navy">Rooms</h3>
                <p className="text-xs text-gray-400 -mt-2">
                  These are the real, bookable rooms. This app is the venue&apos;s schedule now,
                  so what is listed here is what exists.
                </p>

                <div className="space-y-2">
                  {activeRooms.map((room:any) => (
                    <div key={room.id} className="rounded-xl border border-gray-100 overflow-hidden">
                      {editingRoom?.id === room.id ? (
                        <div className="p-4 space-y-2 bg-bt-pale">
                          <input value={editingRoom.name} onChange={e => setEditingRoom({...editingRoom, name: e.target.value})}
                            placeholder="Room name"
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                          <input value={editingRoom.suite} onChange={e => setEditingRoom({...editingRoom, suite: e.target.value})}
                            placeholder="Suite (e.g. Suite 145)"
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                          <select value={editingRoom.room_type} onChange={e => setEditingRoom({...editingRoom, room_type: e.target.value})}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                            <option value="conference_room">Conference Room</option>
                            <option value="private_office">Private Office</option>
                          </select>
                          <input type="number" min="1" value={editingRoom.capacity ?? ''}
                            onChange={e => setEditingRoom({...editingRoom, capacity: e.target.value})}
                            placeholder="Capacity (optional)"
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                          <input value={editingRoom.description ?? ''} onChange={e => setEditingRoom({...editingRoom, description: e.target.value})}
                            placeholder="Description (optional)"
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                          <div className="flex gap-2 pt-1">
                            <button onClick={() => saveRoom(editingRoom, false)} disabled={roomSaving}
                              className="flex-1 bg-bt-navy text-white py-2 rounded-lg font-semibold text-xs disabled:opacity-40">
                              {roomSaving ? 'Saving...' : 'Save'}
                            </button>
                            <button onClick={() => { setEditingRoom(null); setRoomError('') }}
                              className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-lg font-semibold text-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-gray-900 truncate">{room.name}</p>
                            <p className="text-xs text-gray-400 truncate">
                              {room.suite} · {room.room_type === 'private_office' ? 'Private Office' : 'Conference Room'}
                              {room.capacity ? ` · Up to ${room.capacity}` : ''}
                            </p>
                          </div>
                          <button onClick={() => { setEditingRoom({...room}); setRoomError('') }}
                            className="text-xs text-bt-blue font-medium flex-shrink-0">Edit</button>
                          <button onClick={() => setRoomActive(room, false)}
                            className="text-xs text-red-400 font-medium flex-shrink-0">Archive</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add a room */}
                <div className="rounded-xl border-2 border-dashed border-gray-200 p-4 space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Add a room</p>
                  <input value={newRoom.name} onChange={e => setNewRoom({...newRoom, name: e.target.value})}
                    placeholder="Room name"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  <input value={newRoom.suite} onChange={e => setNewRoom({...newRoom, suite: e.target.value})}
                    placeholder="Suite (e.g. Suite 145)"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  <select value={newRoom.room_type} onChange={e => setNewRoom({...newRoom, room_type: e.target.value})}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                    <option value="conference_room">Conference Room</option>
                    <option value="private_office">Private Office</option>
                  </select>
                  <input type="number" min="1" value={newRoom.capacity}
                    onChange={e => setNewRoom({...newRoom, capacity: e.target.value})}
                    placeholder="Capacity (optional)"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  <button onClick={() => saveRoom(newRoom, true)}
                    disabled={roomSaving || !newRoom.name.trim() || !newRoom.suite.trim()}
                    className="w-full bg-bt-navy text-white py-2.5 rounded-lg font-semibold text-xs disabled:opacity-40">
                    {roomSaving ? 'Adding...' : 'Add Room'}
                  </button>
                </div>

                {archivedRooms.length > 0 && (
                  <div>
                    <button onClick={() => setShowArchived(s => !s)}
                      className="text-xs text-gray-400 font-medium">
                      {showArchived ? 'Hide' : 'Show'} archived ({archivedRooms.length})
                    </button>
                    {showArchived && (
                      <div className="space-y-2 mt-2">
                        {archivedRooms.map((room:any) => (
                          <div key={room.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm text-gray-400 truncate line-through">{room.name}</p>
                              <p className="text-xs text-gray-300 truncate">{room.suite}</p>
                            </div>
                            <button onClick={() => setRoomActive(room, true)}
                              className="text-xs text-bt-blue font-medium flex-shrink-0">Restore</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Opening hours */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-bt-navy">Opening Hours</h3>
                  {venueSaved && <span className="text-xs text-green-600 font-semibold">✓ Saved</span>}
                </div>
                <p className="text-xs text-gray-400 -mt-2">
                  The closing time is the latest a booking may <em>end</em>, not the last start time.
                </p>

                {venueError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                    <p className="text-red-700 text-xs font-semibold text-center">{venueError}</p>
                  </div>
                )}

                <div className="space-y-2">
                  {venueHours.map((h:VenueHours) => (
                    <div key={h.day_of_week} className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-600 w-20 flex-shrink-0">{DAY_NAMES[h.day_of_week]}</span>
                      {h.is_closed ? (
                        <span className="flex-1 text-xs text-gray-300 italic">Closed</span>
                      ) : (
                        <>
                          <input type="time" value={h.open_time.slice(0,5)}
                            onChange={e => setVenueHours(prev => prev.map(x => x.day_of_week === h.day_of_week ? {...x, open_time: e.target.value} : x))}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 text-xs" />
                          <span className="text-xs text-gray-300">to</span>
                          <input type="time" value={h.close_time.slice(0,5)}
                            onChange={e => setVenueHours(prev => prev.map(x => x.day_of_week === h.day_of_week ? {...x, close_time: e.target.value} : x))}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 text-xs" />
                        </>
                      )}
                      <button
                        onClick={() => setVenueHours(prev => prev.map(x => x.day_of_week === h.day_of_week ? {...x, is_closed: !x.is_closed} : x))}
                        className={`text-xs font-medium flex-shrink-0 w-12 text-right ${h.is_closed ? 'text-bt-blue' : 'text-gray-400'}`}>
                        {h.is_closed ? 'Open' : 'Close'}
                      </button>
                    </div>
                  ))}
                </div>

                <button onClick={() => saveVenue({ hours: venueHours })} disabled={venueSaving}
                  className="w-full bg-bt-navy text-white py-2.5 rounded-lg font-semibold text-xs disabled:opacity-40">
                  {venueSaving ? 'Saving...' : 'Save Hours'}
                </button>
              </div>

              {/* Booking rules */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-bt-navy">Booking Rules</h3>

                <label className="block">
                  <span className="text-xs font-semibold text-gray-500">Slot length (minutes)</span>
                  <input type="number" min="5" max="240" value={venueSettings.slot_minutes}
                    onChange={e => setVenueSettings({...venueSettings, slot_minutes: Number(e.target.value)})}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  <span className="text-[11px] text-gray-400">How far apart start times sit on the grid.</span>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-500">Shortest booking</span>
                    <input type="number" min="5" value={venueSettings.min_duration_minutes}
                      onChange={e => setVenueSettings({...venueSettings, min_duration_minutes: Number(e.target.value)})}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-500">Longest booking</span>
                    <input type="number" min="5" value={venueSettings.max_duration_minutes}
                      onChange={e => setVenueSettings({...venueSettings, max_duration_minutes: Number(e.target.value)})}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  </label>
                </div>

                <label className="block">
                  <span className="text-xs font-semibold text-gray-500">Book up to (days ahead)</span>
                  <input type="number" min="1" max="730" value={venueSettings.booking_horizon_days}
                    onChange={e => setVenueSettings({...venueSettings, booking_horizon_days: Number(e.target.value)})}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-500">Max upcoming per member</span>
                    <input type="number" min="1" value={venueSettings.max_active_bookings_per_member ?? ''}
                      onChange={e => setVenueSettings({...venueSettings, max_active_bookings_per_member: e.target.value === '' ? null : Number(e.target.value)})}
                      placeholder="No limit"
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-500">Max minutes/day each</span>
                    <input type="number" min="5" value={venueSettings.max_minutes_per_member_per_day ?? ''}
                      onChange={e => setVenueSettings({...venueSettings, max_minutes_per_member_per_day: e.target.value === '' ? null : Number(e.target.value)})}
                      placeholder="No limit"
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  </label>
                </div>
                <p className="text-[11px] text-gray-400">
                  Leave the two limits blank for no cap. They exist because one member holding a
                  room all week is the failure mode a shared calendar invites.
                </p>

                <button onClick={() => saveVenue({ settings: venueSettings })} disabled={venueSaving}
                  className="w-full bg-bt-navy text-white py-2.5 rounded-lg font-semibold text-xs disabled:opacity-40">
                  {venueSaving ? 'Saving...' : 'Save Rules'}
                </button>
              </div>

            </div>
          )
        })()}

        {/* SESSIONS TAB — alumni + monthly drop-in sign-ups */}
        {tab === 'sessions' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <h3 className="font-bold text-bt-navy">Open a Session</h3>
              <p className="text-xs text-gray-400">
                Alumni and drop-in tables are BT-wide, not tied to one table, so
                members without a table can still sign up.
              </p>
              <div className="flex gap-2">
                {(['dropin', 'alumni'] as const).map(k => (
                  <button key={k} onClick={() => setSessionKind(k)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 ${
                      sessionKind === k ? 'border-bt-navy bg-bt-pale text-bt-navy' : 'border-gray-100 text-gray-500'
                    }`}>
                    {k === 'dropin' ? '🔄 Drop-In' : '🎓 Alumni'}
                  </button>
                ))}
              </div>
              <input value={sessionTitle} onChange={e => setSessionTitle(e.target.value)}
                placeholder="Session title" className={inputClass} />
              <input type="datetime-local" value={sessionDate} onChange={e => setSessionDate(e.target.value)}
                className={inputClass} />
              <input value={sessionLocation} onChange={e => setSessionLocation(e.target.value)}
                placeholder="Location (optional)" className={inputClass} />
              <textarea value={sessionDesc} onChange={e => setSessionDesc(e.target.value)} rows={2}
                placeholder="Description (optional)" className={`${inputClass} resize-none`} />
              <input value={sessionCapacity} onChange={e => setSessionCapacity(e.target.value)}
                inputMode="numeric" placeholder="Seats (blank = no limit)" className={inputClass} />
              {sessionError && <p className="text-red-600 text-xs">{sessionError}</p>}
              <button onClick={addSession} disabled={sessionSaving || !sessionTitle.trim() || !sessionDate}
                className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                {sessionSaving ? 'Saving...' : 'Open Sign-Ups'}
              </button>
            </div>

            {sessions.length === 0 && (
              <p className="text-center text-gray-400 py-6">No sessions yet</p>
            )}

            {sessions.map(session => {
              const roster = registrations.filter(r => r.session_id === session.id)
              const seatsLeft = session.capacity === null ? null : session.capacity - roster.length
              const showing = openRoster === session.id

              return (
                <div key={session.id} className="bg-white rounded-2xl p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-bt-pale text-bt-navy px-2 py-0.5 rounded-full">
                          {session.kind === 'alumni' ? '🎓 Alumni' : '🔄 Drop-In'}
                        </span>
                        {!session.open && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                            Closed
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-gray-900 text-sm mt-1.5">{session.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(session.session_date).toLocaleString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric',
                          hour: 'numeric', minute: '2-digit',
                        })}
                      </p>
                      {session.location && <p className="text-xs text-gray-400 mt-0.5">📍 {session.location}</p>}
                      <p className="text-xs font-semibold text-bt-blue mt-1.5">
                        {roster.length} signed up
                        {seatsLeft !== null && ` · ${Math.max(0, seatsLeft)} of ${session.capacity} seats left`}
                      </p>
                    </div>
                    <button onClick={() => deleteSession(session.id)}
                      className="text-red-400 text-xs font-medium flex-shrink-0">
                      Delete
                    </button>
                  </div>

                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button onClick={() => setOpenRoster(showing ? null : session.id)}
                      className="px-3 py-2 rounded-xl text-xs font-semibold bg-bt-pale text-bt-navy">
                      {showing ? 'Hide roster' : `View roster (${roster.length})`}
                    </button>
                    <button onClick={() => toggleSessionOpen(session)}
                      className="px-3 py-2 rounded-xl text-xs font-semibold bg-white text-bt-navy border border-gray-200">
                      {session.open ? 'Close sign-ups' : 'Reopen sign-ups'}
                    </button>
                    {roster.length > 0 && (
                      <button onClick={() => downloadCSV(
                        `${session.kind}-${session.session_date.split('T')[0]}.csv`,
                        [
                          ['Name', 'Email', 'Signed up'],
                          ...roster.map(r => [
                            r.profiles?.full_name || '',
                            r.profiles?.contact_email || '',
                            new Date(r.created_at).toLocaleString('en-US'),
                          ]),
                        ]
                      )}
                        className="px-3 py-2 rounded-xl text-xs font-semibold bg-white text-bt-navy border border-gray-200">
                        ⬇ CSV
                      </button>
                    )}
                  </div>

                  {showing && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                      {roster.length === 0 && (
                        <p className="text-xs text-gray-400">Nobody has signed up yet.</p>
                      )}
                      {roster.map(r => (
                        <div key={r.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-gray-900 truncate">
                              {r.profiles?.full_name || 'Member'}
                            </p>
                            {r.profiles?.contact_email && (
                              <p className="text-xs text-gray-400 truncate">{r.profiles.contact_email}</p>
                            )}
                          </div>
                          <button onClick={() => removeRegistration(r.id)}
                            className="text-red-400 text-xs font-medium flex-shrink-0">
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {/* MEETINGS TAB */}
        {tab === 'meetings' && (() => {
          const plans = resolvedMeetings()
          const group = groups.find(g => g.id === selectedGroup)
          const currentNumber = group?.current_meeting_number ?? null
          const selected = selectedMeetingNumber !== null
            ? plans.find(p => p.number === selectedMeetingNumber) || null
            : null
          const hasOverride = selectedMeetingNumber !== null
            && meetingOverrides.some(p => p.number === selectedMeetingNumber)

          return (
            <div className="space-y-4">
              {meetingError && (
                <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
                  {meetingError}
                </div>
              )}

              {meetingsLoading ? (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <p className="text-gray-400 text-sm">Loading meeting plans...</p>
                </div>
              ) : selected === null ? (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <h3 className="font-bold text-bt-navy mb-1">Meeting Plans</h3>
                  <p className="text-xs text-gray-400 mb-4">
                    The outline for each BT table meeting. Edit the BT default to change it
                    everywhere, or make a version just for {group?.name || 'this table'}.
                  </p>
                  <div className="space-y-2">
                    {plans.map(m => (
                      <button key={m.number} onClick={() => setSelectedMeetingNumber(m.number)}
                        className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-bt-pale hover:bg-bt-light/30 transition-colors text-left">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-bt-blue uppercase tracking-wider">
                              Meeting #{m.number}
                            </span>
                            {m.number === currentNumber && (
                              <span className="text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                Current
                              </span>
                            )}
                            {m.group_id && (
                              <span className="text-[10px] font-bold uppercase tracking-wider bg-bt-light/40 text-bt-navy px-2 py-0.5 rounded-full">
                                Customized
                              </span>
                            )}
                          </div>
                          <p className="font-semibold text-gray-900 text-sm mt-0.5">{m.title}</p>
                        </div>
                        <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    ))}
                    {plans.length === 0 && (
                      <p className="text-sm text-gray-400 py-4">
                        No meeting plans yet. Run the 2026-07-30 migration, then reopen this tab.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <button onClick={() => { setSelectedMeetingNumber(null); setMeetingDraft(null) }}
                    className="flex items-center gap-2 text-sm font-medium text-bt-blue">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    All Meetings
                  </button>

                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-bold text-bt-blue uppercase tracking-wider">
                        Meeting #{selected.number}
                      </p>
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-bt-pale text-bt-navy px-2 py-0.5 rounded-full">
                        {hasOverride ? `${group?.name || 'This table'} only` : 'BT default'}
                      </span>
                    </div>
                    <h2 className="text-xl font-bold text-bt-navy mt-1">{selected.title}</h2>

                    <div className="flex gap-2 mt-4 flex-wrap">
                      <button onClick={() => setCurrentMeeting(
                        currentNumber === selected.number ? null : selected.number
                      )}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                          currentNumber === selected.number
                            ? 'bg-green-600 text-white'
                            : 'bg-bt-pale text-bt-navy border border-bt-navy/15'
                        }`}>
                        {currentNumber === selected.number ? '✓ Current meeting' : 'Mark as current'}
                      </button>
                      <button onClick={() => openMeetingEditor(selected.number, 'table')}
                        className="px-3 py-2 rounded-xl text-xs font-semibold bg-bt-navy text-white">
                        Edit for this table
                      </button>
                      <button onClick={() => openMeetingEditor(selected.number, 'default')}
                        className="px-3 py-2 rounded-xl text-xs font-semibold bg-white text-bt-navy border border-gray-200">
                        Edit BT default
                      </button>
                      {hasOverride && (
                        <button onClick={() => resetMeetingOverride(selected.number)}
                          className="px-3 py-2 rounded-xl text-xs font-semibold text-red-600 border border-red-100">
                          Reset to default
                        </button>
                      )}
                    </div>
                  </div>

                  {meetingDraft ? (
                    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
                      <div className={`rounded-xl px-4 py-3 text-xs ${
                        meetingScope === 'default'
                          ? 'bg-amber-50 text-amber-800 border border-amber-100'
                          : 'bg-bt-pale text-bt-navy'
                      }`}>
                        {meetingScope === 'default'
                          ? 'Editing the BT default — this changes meeting #' + selected.number + ' for every table that has not customized it.'
                          : `Editing for ${group?.name || 'this table'} only. Other tables keep the BT default.`}
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</label>
                        <input value={meetingDraft.title}
                          onChange={e => setMeetingDraft(d => ({ ...d!, title: e.target.value }))}
                          className={inputClass + ' mt-1.5'} />
                      </div>

                      {MEETING_SECTIONS.map(section => (
                        <div key={section.key}>
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                            <span>{section.icon}</span> {section.label}
                          </label>
                          <p className="text-[11px] text-gray-400 mt-0.5 mb-1.5">One bullet per line.</p>
                          <textarea rows={6} value={meetingDraft[section.key] || ''}
                            onChange={e => setMeetingDraft(d => ({ ...d!, [section.key]: e.target.value }))}
                            className={inputClass + ' font-mono text-xs leading-relaxed'} />
                        </div>
                      ))}

                      <div className="flex gap-3">
                        <button onClick={() => setMeetingDraft(null)}
                          className="flex-1 bg-white border border-gray-200 text-bt-navy py-3 rounded-xl font-semibold text-sm">
                          Cancel
                        </button>
                        <button onClick={saveMeetingPlan} disabled={meetingSaving}
                          className="flex-1 bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50">
                          {meetingSaving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {MEETING_SECTIONS.map(section => {
                        const items = selected[section.key] || []
                        if (items.length === 0) return null
                        return (
                          <div key={section.key} className="bg-white rounded-2xl p-5 shadow-sm">
                            <h4 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
                              <span className="text-lg">{section.icon}</span> {section.label}
                            </h4>
                            <ul className="space-y-2">
                              {items.map((item, i) => (
                                <li key={i} className="text-sm text-gray-600 flex gap-2">
                                  <span className="text-gray-300 flex-shrink-0 mt-0.5">•</span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })}

                      <div className="flex gap-3">
                        {plans.findIndex(p => p.number === selected.number) > 0 && (
                          <button onClick={() => setSelectedMeetingNumber(
                            plans[plans.findIndex(p => p.number === selected.number) - 1].number
                          )}
                            className="flex-1 bg-white border border-gray-200 text-bt-navy py-3 rounded-xl font-semibold text-sm">
                            ← Previous
                          </button>
                        )}
                        {plans.findIndex(p => p.number === selected.number) < plans.length - 1 && (
                          <button onClick={() => setSelectedMeetingNumber(
                            plans[plans.findIndex(p => p.number === selected.number) + 1].number
                          )}
                            className="flex-1 bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm">
                            Next →
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )
        })()}

      </div>
      <BottomNav />
    </div>
  )
}

/** A stage of the event notification sequence that has already gone out. */
function NoticeChip({ label }: { label: string }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider bg-green-50 text-green-700 px-1.5 py-0.5 rounded">
      ✓ {label}
    </span>
  )
}
