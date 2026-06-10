'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

type Tab = 'tasks' | 'content' | 'groups' | 'members' | 'scores'

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
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (prof?.role !== 'leader') { router.push('/dashboard'); return }

      const [groupsRes, membersRes] = await Promise.all([
        supabase.from('groups').select('*, last_period_start'),
        fetch('/api/admin/members').then(r => r.json())
      ])
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
    const [t, c] = await Promise.all([
      supabase.from('tasks').select('*').eq('group_id', gid).eq('archived', false).order('created_at', { ascending: false }),
      supabase.from('content').select('*').eq('group_id', gid).order('created_at', { ascending: false })
    ])
    setTasks(t.data || [])
    setContent(c.data || [])
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
          {(['tasks', 'content', 'groups', 'members', 'scores'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
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
                <div key={item.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                  <p className="font-medium text-gray-900 text-sm">{item.title}</p>
                  <p className="text-gray-400 text-xs mt-0.5 capitalize">{item.type}</p>
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
          <div className="space-y-2">
            {users.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-8">No members yet</p>
            )}
            {users.map(u => {
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
            })}
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
      </div>
      <BottomNav />
    </div>
  )
}
