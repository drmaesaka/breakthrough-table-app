'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

export default function DMPage() {
  const { id: conversationId } = useParams<{ id: string }>()
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [user, setUser] = useState<any>(null)
  const [otherPerson, setOtherPerson] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const supabase = createClient()

  async function fetchMessages() {
    const { data } = await supabase
      .from('direct_messages')
      .select('*, profiles(full_name)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    setMessages(data || [])
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      // Load conversation to find other participant
      const { data: convo } = await supabase
        .from('dm_conversations')
        .select('participant_1, participant_2')
        .eq('id', conversationId)
        .single()

      if (!convo) { router.push('/messages'); return }

      const otherId = convo.participant_1 === user.id ? convo.participant_2 : convo.participant_1
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, group_id, groups(name)')
        .eq('id', otherId)
        .single()

      setOtherPerson(prof)
      await fetchMessages()
      setLoading(false)
    }
    load()
  }, [conversationId])

  // Poll every 3 seconds
  useEffect(() => {
    const interval = setInterval(fetchMessages, 3000)
    return () => clearInterval(interval)
  }, [conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMessage.trim() || !user) return
    await supabase.from('direct_messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: newMessage.trim(),
    })
    setNewMessage('')
    fetchMessages()
  }

  function getInitials(name: string) {
    const parts = (name || '').trim().split(' ')
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase() || '?'
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  const otherName = otherPerson?.full_name || 'Member'
  const tableName = (otherPerson?.groups as any)?.name

  return (
    <div style={{ height: '100dvh' }} className="bg-bt-pale flex flex-col">
      {/* Header */}
      <div className="bg-bt-navy px-5 pt-14 pb-4 flex-shrink-0 flex items-center gap-3">
        <Link href="/messages" className="text-white/70 active:text-white p-1 -ml-1">
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="w-9 h-9 rounded-full bg-bt-blue flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">{getInitials(otherName)}</span>
        </div>
        <div>
          <p className="text-white font-bold leading-tight">{otherName}</p>
          {tableName && <p className="text-bt-light/60 text-xs">{tableName}</p>}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">👋</p>
            <p className="text-gray-500 font-medium">Start a conversation</p>
            <p className="text-gray-400 text-sm mt-1">Say hi to {otherName.split(' ')[0]}!</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.sender_id === user?.id
          const prevMsg = messages[i - 1]
          const showName = !isMe && (!prevMsg || prevMsg.sender_id !== msg.sender_id)

          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              {!isMe && (
                <div className="w-7 h-7 rounded-full bg-bt-pale border border-gray-200 flex items-center justify-center flex-shrink-0 mb-0.5">
                  <span className="text-bt-navy font-bold text-xs">{getInitials(otherName)}</span>
                </div>
              )}
              <div className={`flex flex-col max-w-[72%] ${isMe ? 'items-end' : 'items-start'}`}>
                {showName && (
                  <span className="text-xs text-gray-400 font-medium mb-1 px-1">{otherName}</span>
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

      {/* Input */}
      <form onSubmit={sendMessage}
        className="flex-shrink-0 px-4 py-3 bg-white border-t border-gray-100 flex items-center gap-3"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
        <input
          type="text"
          value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          placeholder={`Message ${otherName.split(' ')[0]}...`}
          className="flex-1 bg-bt-pale rounded-full px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
        />
        <button type="submit" disabled={!newMessage.trim()}
          className="w-10 h-10 bg-bt-navy rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </form>
    </div>
  )
}
