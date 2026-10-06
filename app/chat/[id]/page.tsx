'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import PeoplePicker from '@/components/PeoplePicker'

type Member = { user_id: string; full_name: string; avatar_url: string | null }

// A custom group chat — any set of people, across tables. Same shape as the
// DM screen; everything goes through /api/rooms so membership is checked
// server-side and nothing depends on console RLS.
export default function RoomPage() {
  const { id: roomId } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<any>(null)
  const [room, setRoom] = useState<{ id: string; name: string } | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showPeople, setShowPeople] = useState(false)
  const [adding, setAdding] = useState(false)
  const [toAdd, setToAdd] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastIdRef = useRef<string | null>(null)
  const newestSeenRef = useRef<string | null>(null)

  async function headers(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` }
  }

  async function fetchMessages() {
    const after = newestSeenRef.current
    const res = await fetch(`/api/rooms/messages?room_id=${encodeURIComponent(roomId)}${after ? `&after=${encodeURIComponent(after)}` : ''}`, { headers: await headers() })
    if (!res.ok) { if (res.status === 403 || res.status === 404) router.push('/messages'); return }
    const json = await res.json()
    if (!after) {
      setRoom(json.room); setMembers(json.members || [])
      newestSeenRef.current = json.messages[json.messages.length - 1]?.created_at || null
      setMessages(json.messages || [])
    } else if (json.messages?.length) {
      newestSeenRef.current = json.messages[json.messages.length - 1].created_at
      setMessages(prev => { const seen = new Set(prev.map(m => m.id)); return [...prev, ...json.messages.filter((m: any) => !seen.has(m.id))] })
    }
  }

  useEffect(() => {
    newestSeenRef.current = null
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)
      await fetchMessages()
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  useEffect(() => {
    const t = setInterval(fetchMessages, 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null
    if (lastId === lastIdRef.current) return
    lastIdRef.current = lastId
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!newMessage.trim() || sending) return
    setSending(true)
    const res = await fetch('/api/rooms/messages', { method: 'POST', headers: await headers(), body: JSON.stringify({ room_id: roomId, content: newMessage.trim() }) })
    setSending(false)
    if (!res.ok) { setSendError(true); return }
    setSendError(false); setNewMessage('')
    fetchMessages()
  }

  async function addPeople() {
    if (!toAdd.size) return
    setAdding(true); setError('')
    const res = await fetch('/api/rooms', { method: 'PATCH', headers: await headers(), body: JSON.stringify({ room_id: roomId, add: [...toAdd] }) })
    setAdding(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Could not add people'); return }
    setToAdd(new Set()); setShowPeople(false)
    newestSeenRef.current = null
    fetchMessages()
  }

  async function rename() {
    const name = nameDraft.trim()
    if (!name || name === room?.name) return
    setRenaming(true); setError('')
    const res = await fetch('/api/rooms', { method: 'PATCH', headers: await headers(), body: JSON.stringify({ room_id: roomId, name }) })
    setRenaming(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Could not rename'); return }
    setRoom(r => r ? { ...r, name } : r)
  }

  function togglePanel() {
    if (!showPeople) setNameDraft(room?.name || '')
    setShowPeople(v => !v)
  }

  async function leave() {
    if (!confirm(`Leave "${room?.name}"? You can be added back by anyone still in it.`)) return
    await fetch('/api/rooms', { method: 'DELETE', headers: await headers(), body: JSON.stringify({ room_id: roomId }) })
    router.push('/messages')
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>
  )

  const byId = new Map(members.map(m => [m.user_id, m]))

  return (
    <div style={{ height: '100dvh' }} className="bg-bt-pale flex flex-col">
      <div className="bg-bt-navy px-5 pt-14 pb-4 flex-shrink-0">
        {/* pr-10: the top-right corner belongs to the notifications bell. */}
        <div className="flex items-center gap-3 pr-10">
          <Link href="/messages" className="text-white/70 active:text-white p-1 -ml-1">
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <div className="flex-1 min-w-0">
            <button onClick={togglePanel} className="text-white font-bold leading-tight truncate block w-full text-left">👥 {room?.name}</button>
            <button onClick={togglePanel} className="text-bt-light/70 text-xs text-left truncate w-full">
              {members.map(m => m.full_name.split(' ')[0]).join(', ')} · {showPeople ? 'hide' : 'rename · add people'}
            </button>
          </div>
          <button onClick={leave} className="text-white/60 text-xs font-semibold">Leave</button>
        </div>
        <p className="text-bt-light/60 text-[11px] mt-2">🔒 Only the people listed above can see this.</p>
      </div>

      {showPeople && (
        <div className="bg-white border-b border-gray-100 px-4 py-3 space-y-2 flex-shrink-0">
          <p className="text-xs text-gray-400 font-medium">Group name</p>
          <div className="flex gap-2">
            <input type="text" value={nameDraft} onChange={e => setNameDraft(e.target.value)} maxLength={60}
              className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue" />
            <button onClick={rename} disabled={renaming || !nameDraft.trim() || nameDraft.trim() === room?.name}
              className="bg-bt-navy text-white px-4 rounded-xl text-sm font-semibold disabled:opacity-40">
              {renaming ? 'Saving...' : 'Rename'}
            </button>
          </div>
          <p className="text-xs text-gray-400 font-medium pt-1">Add people to this group</p>
          <PeoplePicker exclude={members.map(m => m.user_id)} selected={toAdd} onChange={setToAdd} />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button onClick={addPeople} disabled={adding || !toAdd.size}
            className="w-full bg-bt-navy text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40">
            {adding ? 'Adding...' : toAdd.size ? `Add ${toAdd.size}` : 'Pick people above'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">👥</p>
            <p className="text-gray-500 font-medium">New group</p>
            <p className="text-gray-400 text-sm mt-1">Say hello — everyone here will get one ping.</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.user_id === user?.id
          const prev = messages[i - 1]
          const showName = !isMe && (!prev || prev.user_id !== msg.user_id)
          const p = Array.isArray(msg.profiles) ? msg.profiles[0] : msg.profiles
          const name = p?.full_name || byId.get(msg.user_id)?.full_name || 'Member'
          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              {!isMe && <Avatar src={p?.avatar_url} name={name} className="w-7 h-7 bg-bt-pale border border-gray-200 mb-0.5" textClass="text-bt-navy font-bold text-xs" />}
              <div className={`flex flex-col max-w-[72%] ${isMe ? 'items-end' : 'items-start'}`}>
                {showName && <span className="text-xs text-gray-400 font-medium mb-1 px-1">{name}</span>}
                <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${isMe ? 'bg-bt-navy text-white rounded-br-sm' : 'bg-white text-gray-900 shadow-sm rounded-bl-sm'}`}>{msg.content}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex-shrink-0 px-4 py-3 bg-white border-t border-gray-100 flex items-center gap-3"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
        <input type="text" value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder={`Message ${room?.name || 'the group'}...`}
          className="flex-1 bg-bt-pale rounded-full px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue" />
        <button type="submit" disabled={!newMessage.trim() || sending}
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 ${sendError ? 'bg-red-600' : 'bg-bt-navy'}`}
          title={sendError ? "Didn't send — tap to try again" : 'Send'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>
        </button>
      </form>
    </div>
  )
}
