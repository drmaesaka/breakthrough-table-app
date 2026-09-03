'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import Avatar from '@/components/Avatar'

// The TCs' own space: one channel across every table, plus a shared shelf of
// internal material. Table chat is scoped to a group_id and DMs are one-to-one,
// so before this there was no room where all the TCs were in the same place.
//
// Both tables are leader-only at the RLS level, not just hidden behind this
// page — a participant who guesses the URL still reads nothing.

type Resource = {
  id: string
  title: string
  url: string
  type: string | null
  description: string | null
  created_at: string
  profiles?: { full_name: string | null } | null
}

export default function LeadersPage() {
  const [tab, setTab] = useState<'resources' | 'chat'>('resources')
  const [checking, setChecking] = useState(true)
  const [user, setUser] = useState<any>(null)

  // Chat
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const newestSeenRef = useRef<string | null>(null)
  const lastIdRef = useRef<string | null>(null)

  // Resources
  const [resources, setResources] = useState<Resource[]>([])
  const [resTitle, setResTitle] = useState('')
  const [resUrl, setResUrl] = useState('')
  const [resType, setResType] = useState('document')
  const [resDesc, setResDesc] = useState('')
  const [resSaving, setResSaving] = useState(false)
  const [resError, setResError] = useState('')

  const router = useRouter()
  const supabase = createClient()

  // Same delta-poll shape as table chat: the first load takes the newest 200,
  // every poll after asks only for what is newer. Refetching the whole thread
  // every few seconds per open tab is what burned through Supabase egress.
  async function fetchMessages() {
    const newestSeen = newestSeenRef.current
    if (!newestSeen) {
      const { data: page, error } = await supabase
        .from('leader_messages')
        .select('*, profiles(full_name, avatar_url)')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error || !page) {
        if (error) console.error('leader messages fetch failed:', error.message)
        return
      }
      const data = [...page].reverse()
      newestSeenRef.current = data[data.length - 1]?.created_at || null
      setMessages(data)
      return
    }

    const { data: fresh, error } = await supabase
      .from('leader_messages')
      .select('*, profiles(full_name, avatar_url)')
      .gt('created_at', newestSeen)
      .order('created_at', { ascending: true })
    if (error || !fresh || fresh.length === 0) {
      if (error) console.error('leader messages poll failed:', error.message)
      return
    }
    newestSeenRef.current = fresh[fresh.length - 1].created_at
    setMessages(prev => {
      const seen = new Set(prev.map(m => m.id))
      return [...prev, ...fresh.filter(m => !seen.has(m.id))]
    })
  }

  async function fetchResources() {
    const { data, error } = await supabase
      .from('leader_resources')
      .select('*, profiles(full_name, avatar_url)')
      .order('created_at', { ascending: false })
    if (error) { console.error('leader resources fetch failed:', error.message); return }
    setResources((data || []) as Resource[])
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (profile?.role !== 'leader') { router.push('/dashboard'); return }

      setUser(user)
      await Promise.all([fetchResources(), fetchMessages()])
      setChecking(false)
    }
    load()
  }, [router])

  useEffect(() => {
    const interval = setInterval(() => { if (tab === 'chat') fetchMessages() }, 3000)
    return () => clearInterval(interval)
  }, [tab])

  // Keyed by the newest message id rather than the array, which the poll
  // replaces every tick and which would otherwise re-scroll on a loop.
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null
    if (lastId === lastIdRef.current) return
    lastIdRef.current = lastId
    if (tab === 'chat') bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, tab])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMessage.trim() || !user || sending) return
    setSending(true)
    const { error } = await supabase
      .from('leader_messages')
      .insert({ user_id: user.id, content: newMessage.trim() })
    setSending(false)
    // Keep what they typed if the insert was rejected.
    if (error) { console.error('leader message send failed:', error.message); setSendError(true); return }
    setSendError(false)
    setNewMessage('')
    fetchMessages()
  }

  async function addResource() {
    if (!resTitle.trim()) { setResError('Title is required'); return }
    if (!resUrl.trim()) { setResError('Link is required'); return }
    setResSaving(true)
    setResError('')
    const { data, error } = await supabase.from('leader_resources').insert({
      title: resTitle.trim(),
      url: resUrl.trim(),
      type: resType,
      description: resDesc.trim() || null,
      created_by: user.id,
    }).select('*, profiles(full_name, avatar_url)').single()
    setResSaving(false)
    if (error) { setResError(error.message); return }
    setResources(p => [data as Resource, ...p])
    setResTitle(''); setResUrl(''); setResDesc('')
  }

  async function deleteResource(id: string) {
    if (!confirm('Remove this resource for every TC?')) return
    const { error } = await supabase.from('leader_resources').delete().eq('id', id)
    if (error) { setResError(error.message); return }
    setResources(p => p.filter(r => r.id !== id))
  }

  function getInitials(name: string) {
    const parts = (name || '').trim().split(' ')
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase() || '?'
  }

  const inputClass = "w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"

  if (checking) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div style={{ height: '100dvh' }} className="bg-bt-pale flex flex-col">
      <div className="bg-bt-navy px-5 pt-14 pb-0 flex-shrink-0">
        <h1 className="text-white text-2xl font-bold">TC Room</h1>
        <p className="text-bt-light/60 text-sm mt-0.5 mb-3">Leaders only — not visible to members</p>
        <div className="flex gap-1">
          {(['resources', 'chat'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ${
                tab === t ? 'bg-bt-pale text-bt-navy' : 'text-white/60 hover:text-white/80'
              }`}>
              {t === 'resources' ? '📁 Resources' : '💬 TC Chat'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'resources' && (
        <div className="flex-1 overflow-y-auto px-5 py-5 pb-28 space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-bt-navy mb-3">Add a resource</h3>
            <div className="space-y-3">
              <input value={resTitle} onChange={e => setResTitle(e.target.value)}
                placeholder="Title" className={inputClass} />
              <input value={resUrl} onChange={e => setResUrl(e.target.value)}
                placeholder="https://..." className={inputClass} />
              <select value={resType} onChange={e => setResType(e.target.value)} className={inputClass}>
                {['document', 'video', 'training', 'template', 'link'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <textarea value={resDesc} onChange={e => setResDesc(e.target.value)} rows={2}
                placeholder="What is this for? (optional)" className={inputClass} />
              {resError && <p className="text-red-600 text-xs">{resError}</p>}
              <button onClick={addResource} disabled={resSaving}
                className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50">
                {resSaving ? 'Saving...' : 'Add Resource'}
              </button>
            </div>
          </div>

          {resources.length === 0 && (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">📁</p>
              <p className="text-gray-500 font-medium">No shared resources yet</p>
              <p className="text-gray-400 text-sm mt-1">Anything added here is visible to every TC</p>
            </div>
          )}

          {resources.map(r => (
            <div key={r.id} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {r.type && (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-bt-pale text-bt-blue px-2 py-0.5 rounded-full">
                      {r.type}
                    </span>
                  )}
                  <h4 className="font-bold text-gray-900 text-sm mt-1.5">{r.title}</h4>
                  {r.description && (
                    <p className="text-gray-500 text-sm mt-1 leading-relaxed">{r.description}</p>
                  )}
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                    className="text-bt-blue text-xs underline break-all mt-2 inline-block">
                    Open →
                  </a>
                  <p className="text-gray-300 text-[11px] mt-2">
                    Added by {r.profiles?.full_name || 'a TC'}
                  </p>
                </div>
                <button onClick={() => deleteResource(r.id)}
                  className="text-red-500 text-xs font-medium flex-shrink-0">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'chat' && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-16">
                <p className="text-4xl mb-3">💬</p>
                <p className="text-gray-500 font-medium">No messages yet</p>
                <p className="text-gray-400 text-sm mt-1">This channel is just for TCs</p>
              </div>
            )}
            {messages.map((msg, i) => {
              const isMe = msg.user_id === user?.id
              const name = msg.profiles?.full_name || 'TC'
              const prevMsg = messages[i - 1]
              const showName = !isMe && (!prevMsg || prevMsg.user_id !== msg.user_id)

              return (
                <div key={msg.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                  {!isMe && (
                    <Avatar src={msg.profiles?.avatar_url} name={name} className="w-7 h-7 bg-bt-pale border border-gray-200 mb-0.5" textClass="text-bt-navy font-bold text-xs" />
                  )}
                  <div className={`flex flex-col max-w-[72%] ${isMe ? 'items-end' : 'items-start'}`}>
                    {showName && (
                      <span className="text-xs text-gray-400 font-medium mb-1 px-1">{name}</span>
                    )}
                    <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      isMe ? 'bg-bt-navy text-white rounded-br-sm' : 'bg-white text-gray-900 shadow-sm rounded-bl-sm'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={sendMessage}
            className="flex-shrink-0 px-4 py-3 bg-white border-t border-gray-100 flex items-center gap-3"
            style={{ paddingBottom: 'calc(0.75rem + 60px)' }}>
            <input type="text" value={newMessage} onChange={e => setNewMessage(e.target.value)}
              placeholder="Message the other TCs..."
              className="flex-1 bg-bt-pale rounded-full px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue" />
            <button type="submit" disabled={!newMessage.trim() || sending}
              className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity ${sendError ? 'bg-red-600' : 'bg-bt-navy'}`}
              title={sendError ? "Didn't send — tap to try again" : 'Send'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </form>
        </>
      )}

      <BottomNav />
    </div>
  )
}
