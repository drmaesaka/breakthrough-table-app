'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function AdminPage() {
  const [user, setUser] = useState<any>(null)
  const [groups, setGroups] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [newGroupName, setNewGroupName] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskDue, setNewTaskDue] = useState('')
  const [newTaskGroupId, setNewTaskGroupId] = useState('')
  const [newContentTitle, setNewContentTitle] = useState('')
  const [newContentUrl, setNewContentUrl] = useState('')
  const [newContentType, setNewContentType] = useState('video')
  const [newContentDesc, setNewContentDesc] = useState('')
  const [newContentGroupId, setNewContentGroupId] = useState('')
  const [assignUserId, setAssignUserId] = useState('')
  const [assignGroupId, setAssignGroupId] = useState('')

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)
      const { data: g } = await supabase.from('groups').select('*')
      setGroups(g || [])
      const { data: u } = await supabase.from('profiles').select('*')
      setUsers(u || [])
      setLoading(false)
    }
    load()
  }, [])

  async function createGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!newGroupName.trim()) return
    const { data, error } = await supabase
      .from('groups')
      .insert({ name: newGroupName, leader_id: user.id })
      .select()
      .single()
    if (!error && data) {
      setGroups(prev => [...prev, data])
      setNewGroupName('')
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTaskTitle.trim() || !newTaskGroupId) return
    await supabase.from('tasks').insert({
      title: newTaskTitle,
      description: newTaskDesc,
      due_date: newTaskDue || null,
      group_id: newTaskGroupId
    })
    setNewTaskTitle('')
    setNewTaskDesc('')
    setNewTaskDue('')
    setNewTaskGroupId('')
    alert('Task posted!')
  }

  async function addContent(e: React.FormEvent) {
    e.preventDefault()
    if (!newContentTitle.trim() || !newContentUrl.trim() || !newContentGroupId) return
    await supabase.from('content').insert({
      title: newContentTitle,
      description: newContentDesc,
      url: newContentUrl,
      content_type: newContentType,
      group_id: newContentGroupId
    })
    setNewContentTitle('')
    setNewContentUrl('')
    setNewContentDesc('')
    setNewContentGroupId('')
    alert('Content added!')
  }

  async function assignUser(e: React.FormEvent) {
    e.preventDefault()
    if (!assignUserId || !assignGroupId) return
    await supabase
      .from('profiles')
      .update({ group_id: assignGroupId })
      .eq('id', assignUserId)
    setAssignUserId('')
    setAssignGroupId('')
    alert('User assigned!')
  }

  const inputClass = "w-full border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
  const labelClass = "block text-sm font-medium text-gray-700 mb-1"
  const btnClass = "bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
  const sectionClass = "bg-white rounded-2xl p-6 shadow-sm border border-gray-100"

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Breakthrough Table — Admin</h1>
        <a href="/dashboard" className="text-sm text-blue-600 hover:underline">← Dashboard</a>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-10 flex flex-col gap-10">

        {/* Create Group */}
        <section className={sectionClass}>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Create a Group</h2>
          <form onSubmit={createGroup} className="flex gap-3">
            <input
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              placeholder="Group name"
              className={inputClass}
            />
            <button type="submit" className={btnClass}>Create</button>
          </form>
          {groups.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {groups.map(g => (
                <li key={g.id} className="text-sm font-medium text-gray-800 bg-gray-50 px-4 py-2 rounded-lg">
                  {g.name}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Assign User to Group */}
        <section className={sectionClass}>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Assign User to Group</h2>
          <form onSubmit={assignUser} className="flex flex-col gap-3">
            <div>
              <label className={labelClass}>User</label>
              <select value={assignUserId} onChange={e => setAssignUserId(e.target.value)} className={inputClass}>
                <option value="">Select a user</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name || u.id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Group</label>
              <select value={assignGroupId} onChange={e => setAssignGroupId(e.target.value)} className={inputClass}>
                <option value="">Select a group</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className={btnClass}>Assign</button>
          </form>
        </section>

        {/* Post a Task */}
        <section className={sectionClass}>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Post a Task</h2>
          <form onSubmit={createTask} className="flex flex-col gap-3">
            <div>
              <label className={labelClass}>Title</label>
              <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Task title" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Description (optional)</label>
              <textarea value={newTaskDesc} onChange={e => setNewTaskDesc(e.target.value)} placeholder="Describe the task..." className={inputClass} rows={2} />
            </div>
            <div>
              <label className={labelClass}>Due Date (optional)</label>
              <input type="date" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Group</label>
              <select value={newTaskGroupId} onChange={e => setNewTaskGroupId(e.target.value)} className={inputClass}>
                <option value="">Select a group</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className={btnClass}>Post Task</button>
          </form>
        </section>

        {/* Add Content */}
        <section className={sectionClass}>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Add Content</h2>
          <form onSubmit={addContent} className="flex flex-col gap-3">
            <div>
              <label className={labelClass}>Title</label>
              <input value={newContentTitle} onChange={e => setNewContentTitle(e.target.value)} placeholder="Content title" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Description (optional)</label>
              <textarea value={newContentDesc} onChange={e => setNewContentDesc(e.target.value)} placeholder="Description..." className={inputClass} rows={2} />
            </div>
            <div>
              <label className={labelClass}>URL</label>
              <input value={newContentUrl} onChange={e => setNewContentUrl(e.target.value)} placeholder="https://..." className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <select value={newContentType} onChange={e => setNewContentType(e.target.value)} className={inputClass}>
                <option value="video">Video</option>
                <option value="pdf">PDF</option>
                <option value="article">Article</option>
                <option value="link">Link</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Group</label>
              <select value={newContentGroupId} onChange={e => setNewContentGroupId(e.target.value)} className={inputClass}>
                <option value="">Select a group</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className={btnClass}>Add Content</button>
          </form>
        </section>

      </main>
    </div>
  )
}