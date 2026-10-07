'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { notifyAbout } from '@/lib/notify-client'
import Avatar from '@/components/Avatar'

/**
 * One table's chat: the message list and the send box. Lived on the Chat
 * tab until 2026-10-07, when it moved to My Table so a table's page is its
 * home. The parent gives it a flex column to fill.
 *
 * The table the person sits at is read and written browser→Supabase. A table
 * a leader runs but does not sit at goes through /api/messages: RLS scopes
 * the browser to the person's own table.
 */
export default function TableChat({ groupId, groupName, homeGroupId, userId }: {
  groupId: string
  groupName: string
  homeGroupId: string | null
  userId: string
}) {
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const groupIdRef = useRef(groupId)
  const lastIdRef = useRef<string | null>(null)
  const newestSeenRef = useRef<string | null>(null)
  const supabase = createClient()
  const isHome = groupId === homeGroupId

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` }
  }

  async function fetchMessages(gid: string) {
    // First load: the newest 200, flipped for display. Every poll after that
    // asks only for rows newer than what's on screen — the old full refetch
    // every 3 seconds re-downloaded the entire history per tick per open tab,
    // which is the kind of traffic that burns through Supabase's free egress
    // quota and starts failing reads app-wide.
    const newestSeen = newestSeenRef.current

    if (gid !== homeGroupId) {
      const res = await fetch(
        `/api/messages?group_id=${encodeURIComponent(gid)}${newestSeen ? `&after=${encodeURIComponent(newestSeen)}` : ''}`,
        { headers: await authHeaders() }
      )
      if (!res.ok) { console.error('messages fetch failed:', res.status); return }
      const { messages: rows } = await res.json()
      // The poll may resolve after the person switched tables; drop it then.
      if (groupIdRef.current !== gid || !rows) return
      if (!newestSeen) {
        newestSeenRef.current = rows[rows.length - 1]?.created_at || null
        setMessages(rows)
      } else if (rows.length > 0) {
        newestSeenRef.current = rows[rows.length - 1].created_at
        setMessages(prev => {
          const seen = new Set(prev.map(m => m.id))
          return [...prev, ...rows.filter((m: any) => !seen.has(m.id))]
        })
      }
      return
    }

    if (!newestSeen) {
      const { data: page, error } = await supabase
        .from('messages')
        .select('*, profiles(full_name, avatar_url)')
        .eq('group_id', gid)
        .order('created_at', { ascending: false })
        .limit(200)
      // Keep what is on screen if a poll fails rather than wiping it to the
      // empty state on a transient error.
      if (error || !page) {
        if (error) console.error('messages fetch failed:', error.message)
        return
      }
      if (groupIdRef.current !== gid) return
      const data = [...page].reverse()
      newestSeenRef.current = data[data.length - 1]?.created_at || null
      setMessages(data)
      return
    }

    const { data: fresh, error } = await supabase
      .from('messages')
      .select('*, profiles(full_name, avatar_url)')
      .eq('group_id', gid)
      .gt('created_at', newestSeen)
      .order('created_at', { ascending: true })
    if (error || !fresh || fresh.length === 0) {
      if (error) console.error('messages poll failed:', error.message)
      return
    }
    if (groupIdRef.current !== gid) return
    newestSeenRef.current = fresh[fresh.length - 1].created_at
    setMessages(prev => {
      // Guard against a race double-appending the same rows.
      const seen = new Set(prev.map(m => m.id))
      return [...prev, ...fresh.filter(m => !seen.has(m.id))]
    })
  }

  // Load on mount and whenever the table changes, then poll every 3 seconds.
  useEffect(() => {
    groupIdRef.current = groupId
    newestSeenRef.current = null
    lastIdRef.current = null
    setMessages([])
    setSendError(false)
    fetchMessages(groupId)
    const interval = setInterval(() => fetchMessages(groupId), 3000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  // Scroll only when a message actually arrives. The poll hands back a new
  // array every time, so depending on `messages` alone re-scrolled on a loop
  // and made it impossible to read back through the conversation.
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null
    if (lastId === lastIdRef.current) return
    lastIdRef.current = lastId
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMessage.trim() || sending) return
    const text = newMessage.trim()
    setSending(true)
    let error: { message: string } | null = null
    if (!isHome) {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ group_id: groupId, content: text }),
      })
      if (!res.ok) error = { message: `send failed (${res.status})` }
    } else {
      const r = await supabase.from('messages').insert({ group_id: groupId, user_id: userId, content: text }).select('id').single()
      error = r.error
      if (!r.error) notifyAbout('chat', r.data?.id)
    }
    setSending(false)
    // Keep the member's text in the box if the send failed.
    if (error) {
      console.error('message send failed:', error.message)
      setSendError(true)
      return
    }
    setSendError(false)
    setNewMessage('')
    fetchMessages(groupId)
  }

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        <p className="text-center text-[11px] text-gray-400">🔒 Only the people at {groupName || 'this table'} can see this.</p>
        {messages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">💬</p>
            <p className="text-gray-500 font-medium">No messages yet</p>
            <p className="text-gray-400 text-sm mt-1">Say hello to your tablemates!</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.user_id === userId
          const name = msg.profiles?.full_name || 'Member'
          const prevMsg = messages[i - 1]
          const showName = !isMe && (!prevMsg || prevMsg.user_id !== msg.user_id)
          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              {!isMe && (
                <Avatar src={msg.profiles?.avatar_url} name={name} className="w-7 h-7 bg-bt-pale border border-gray-200 mb-0.5" textClass="text-bt-navy font-bold text-xs" />
              )}
              <div className={`flex flex-col max-w-[72%] ${isMe ? 'items-end' : 'items-start'}`}>
                {showName && <span className="text-xs text-gray-400 font-medium mb-1 px-1">{name}</span>}
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
        <input
          type="text"
          value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          placeholder={isHome ? 'Message your table...' : `Message ${groupName}...`}
          className="flex-1 bg-bt-pale rounded-full px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
        />
        <button type="submit" disabled={!newMessage.trim() || sending}
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity ${sendError ? 'bg-red-600' : 'bg-bt-navy'}`}
          title={sendError ? "Didn't send — tap to try again" : 'Send'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </form>
    </>
  )
}
