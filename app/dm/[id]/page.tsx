'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { notifyAbout } from '@/lib/notify-client'
import { usePhotoAttach, PhotoButton, PhotoPreview, MessagePhoto } from '@/components/ChatPhoto'
import { useReactions, MessageReactions } from '@/components/Reactions'
import { GifButton } from '@/components/GifPicker'
import ChatInput from '@/components/ChatInput'
import Avatar from '@/components/Avatar'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

export default function DMPage() {
  const { id: conversationId } = useParams<{ id: string }>()
  const [messages, setMessages] = useState<any[]>([])
  const rx = useReactions('direct', messages.map(m => m.id))
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [user, setUser] = useState<any>(null)
  const att = usePhotoAttach(user?.id)
  const [otherPerson, setOtherPerson] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastCountRef = useRef<string | number | null>(0)
  const newestSeenRef = useRef<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function fetchMessages() {
    // First load: newest 200, flipped. Polls after that fetch only rows newer
    // than what's on screen — see app/messages for why (free-tier egress).
    const newestSeen = newestSeenRef.current
    if (!newestSeen) {
      const { data: page, error } = await supabase
        .from('direct_messages')
        .select('*, profiles(full_name)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(200)
      // Keep the conversation on screen if a poll fails — see app/messages.
      if (error || !page) {
        if (error) console.error('dm fetch failed:', error.message)
        return
      }
      const data = [...page].reverse()
      newestSeenRef.current = data[data.length - 1]?.created_at || null
      setMessages(data)
      return
    }

    const { data: fresh, error } = await supabase
      .from('direct_messages')
      .select('*, profiles(full_name)')
      .eq('conversation_id', conversationId)
      .gt('created_at', newestSeen)
      .order('created_at', { ascending: true })
    if (error || !fresh || fresh.length === 0) {
      if (error) console.error('dm poll failed:', error.message)
      return
    }
    newestSeenRef.current = fresh[fresh.length - 1].created_at
    setMessages(prev => {
      const seen = new Set(prev.map(m => m.id))
      return [...prev, ...fresh.filter(m => !seen.has(m.id))]
    })
  }

  useEffect(() => {
    newestSeenRef.current = null // full refetch when switching conversations
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
        .select('full_name, group_id, avatar_url, groups(name)')
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

  // Only scroll when a message actually arrives, not on every poll. Keyed by
  // the newest message id — the count stops changing once the 200-message
  // window is full.
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null
    if (lastId === lastCountRef.current) return
    lastCountRef.current = lastId
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if ((!newMessage.trim() && !att.photo) || !user || sending || att.busy) return
    const text = newMessage.trim()
    setSending(true)
    const { data: sent, error } = await supabase.from('direct_messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: text,
      ...(att.photo ? { image_url: att.photo } : {}),
    }).select('id').single()
    setSending(false)
    if (!error) notifyAbout('dm', sent?.id)
    
    if (error) {
      console.error('dm send failed:', error.message)
      setSendError(true)
      return
    }
    setSendError(false)
    setNewMessage('')
    att.clear()
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
        <Avatar src={otherPerson?.avatar_url} name={otherName} className="w-9 h-9 bg-bt-blue" textClass="text-white font-bold text-sm" />
        <div>
          <p className="text-white font-bold leading-tight">{otherName}</p>
          {tableName && <p className="text-bt-light/60 text-xs">{tableName}</p>}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-6 space-y-3">
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
                <Avatar src={otherPerson?.avatar_url} name={otherName} className="w-7 h-7 bg-bt-pale border border-gray-200 mb-0.5" textClass="text-bt-navy font-bold text-xs" />
              )}
              <div {...rx.holdProps(msg.id)} className={`chat-hold flex flex-col max-w-[72%] ${isMe ? 'items-end' : 'items-start'}`}>
                {showName && (
                  <span className="text-xs text-gray-400 font-medium mb-1 px-1">{otherName}</span>
                )}
                <MessagePhoto url={msg.image_url} />
                {msg.content && (
                  <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    isMe ? 'bg-bt-navy text-white rounded-br-sm' : 'bg-white text-gray-900 shadow-sm rounded-bl-sm'
                  }`}>
                    {rx.text(msg)}
                  </div>
                )}
                <MessageReactions id={msg.id} state={rx} isMe={isMe} content={rx.text(msg)} />
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <PhotoPreview att={att} />
      <form onSubmit={sendMessage}
        className={`flex-shrink-0 px-4 py-3 bg-white flex items-end gap-2 ${att.active ? '' : 'border-t border-gray-100'}`}
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
        <PhotoButton att={att} />
        <GifButton att={att} />
        <ChatInput value={newMessage} onChange={setNewMessage} placeholder={`Message ${otherName.split(' ')[0]}...`} />
        <button type="submit" disabled={(!newMessage.trim() && !att.photo) || sending || att.busy}
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity ${sendError ? 'bg-red-600' : 'bg-bt-navy'}`}
          title={sendError ? "Didn't send — tap to try again" : 'Send'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </form>
    </div>
  )
}
