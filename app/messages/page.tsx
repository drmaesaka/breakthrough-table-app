'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import BottomNav from '@/components/BottomNav'

export default function MessagesPage() {
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [user, setUser] = useState<any>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const groupIdRef = useRef<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function fetchMessages(gid: string) {
    const { data } = await supabase
      .from('messages')
      .select('*, profiles(full_name)')
      .eq('group_id', gid)
      .order('created_at', { ascending: true })
    setMessages(data || [])
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      const { data: profile } = await supabase
        .from('profiles')
        .select('group_id, groups(name)')
        .eq('id', user.id)
        .single()

      if (profile?.group_id) {
        setGroupId(profile.group_id)
        setGroupName((profile.groups as any)?.name || 'Group Chat')
        groupIdRef.current = profile.group_id
        await fetchMessages(profile.group_id)
      }
      setLoading(false)
    }
    load()
  }, [])

  // Poll every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (groupIdRef.current) fetchMessages(groupIdRef.current)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMessage.trim() || !groupId || !user) return
    await supabase.from('messages').insert({
      group_id: groupId,
      user_id: user.id,
      content: newMessage.trim()
    })
    setNewMessage('')
    fetchMessages(groupId)
  }

  function getInitials(name: string) {
    return name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div style={{ height: '100dvh' }} className="bg-bt-pale flex flex-col">
      {/* Header */}
      <div className="bg-bt-navy px-5 pt-14 pb-4 flex-shrink-0">
        <h1 className="text-white text-2xl font-bold">Group Chat</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">{groupName}</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">💬</p>
            <p className="text-gray-500 font-medium">No messages yet</p>
            <p className="text-gray-400 text-sm mt-1">Say hello to your table!</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.user_id === user?.id
          const name = msg.profiles?.full_name || 'Member'
          const prevMsg = messages[i - 1]
          const showName = !isMe && (!prevMsg || prevMsg.user_id !== msg.user_id)

          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              {/* Avatar — only show for others, on last message in a run */}
              {!isMe && (
                <div className="w-7 h-7 rounded-full bg-bt-pale border border-gray-200 flex items-center justify-center flex-shrink-0 mb-0.5">
                  <span className="text-bt-navy font-bold text-xs">{getInitials(name)}</span>
                </div>
              )}

              <div className={`flex flex-col max-w-[72%] ${isMe ? 'items-end' : 'items-start'}`}>
                {showName && (
                  <span className="text-xs text-gray-400 font-medium mb-1 px-1">{name}</span>
                )}
                <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  isMe
                    ? 'bg-bt-navy text-white rounded-br-sm'
                    : 'bg-white text-gray-900 shadow-sm rounded-bl-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!groupId ? (
        <div className="px-5 py-4 text-center text-gray-400 text-sm">
          You need to be in a group to chat.
        </div>
      ) : (
        <form onSubmit={sendMessage}
          className="flex-shrink-0 px-4 py-3 bg-white border-t border-gray-100 flex items-center gap-3"
          style={{ paddingBottom: 'calc(0.75rem + 60px)' }}>
          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder="Message your table..."
            className="flex-1 bg-bt-pale rounded-full px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
          />
          <button type="submit" disabled={!newMessage.trim()}
            className="w-10 h-10 bg-bt-navy rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </form>
      )}

      <BottomNav />
    </div>
  )
}
