'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import BottomNav from '@/components/BottomNav'

export default function MessagesPage() {
  const [tab, setTab] = useState<'table' | 'dms'>('table')

  // Table chat state
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [user, setUser] = useState<any>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const groupIdRef = useRef<string | null>(null)

  // DM state
  const [conversations, setConversations] = useState<any[]>([])
  const [dmsLoading, setDmsLoading] = useState(false)

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

  async function fetchDMs(userId: string) {
    setDmsLoading(true)
    const { data } = await supabase
      .from('dm_conversations')
      .select('id, participant_1, participant_2, created_at')
      .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
      .order('created_at', { ascending: false })

    if (!data) { setDmsLoading(false); return }

    // Get the other person's profile for each convo
    const enriched = await Promise.all(data.map(async (convo: any) => {
      const otherId = convo.participant_1 === userId ? convo.participant_2 : convo.participant_1
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, group_id, groups(name)')
        .eq('id', otherId)
        .single()
      // Get latest message
      const { data: lastMsg } = await supabase
        .from('direct_messages')
        .select('content, created_at')
        .eq('conversation_id', convo.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      return { ...convo, other: prof, otherId, lastMsg }
    }))

    setConversations(enriched)
    setDmsLoading(false)
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

  // Poll table chat every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (groupIdRef.current && tab === 'table') fetchMessages(groupIdRef.current)
    }, 3000)
    return () => clearInterval(interval)
  }, [tab])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (tab === 'dms' && user) fetchDMs(user.id)
  }, [tab, user])

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
    const parts = (name || '').trim().split(' ')
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase() || '?'
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div style={{ height: '100dvh' }} className="bg-bt-pale flex flex-col">
      {/* Header */}
      <div className="bg-bt-navy px-5 pt-14 pb-0 flex-shrink-0">
        <h1 className="text-white text-2xl font-bold mb-3">Messages</h1>
        {/* Tabs */}
        <div className="flex gap-1">
          {(['table', 'dms'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ${
                tab === t ? 'bg-bt-pale text-bt-navy' : 'text-white/60 hover:text-white/80'
              }`}>
              {t === 'table' ? `💬 ${groupName || 'Table'}` : '✉️ Direct Messages'}
            </button>
          ))}
        </div>
      </div>

      {/* Table Chat */}
      {tab === 'table' && (
        <>
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
        </>
      )}

      {/* DMs Tab */}
      {tab === 'dms' && (
        <div className="flex-1 overflow-y-auto pb-20">
          <div className="px-5 py-4">
            <Link href="/directory"
              className="flex items-center gap-3 bg-bt-navy text-white px-4 py-3.5 rounded-2xl font-semibold text-sm mb-4">
              <span className="text-xl">👥</span>
              <div>
                <p className="font-semibold">Browse Member Directory</p>
                <p className="text-white/60 text-xs font-normal mt-0.5">Start a new conversation</p>
              </div>
              <svg className="ml-auto w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>

            {dmsLoading && <p className="text-center text-gray-400 py-8">Loading...</p>}

            {!dmsLoading && conversations.length === 0 && (
              <div className="text-center py-12">
                <p className="text-4xl mb-3">✉️</p>
                <p className="text-gray-500 font-medium">No direct messages yet</p>
                <p className="text-gray-400 text-sm mt-1">Find members in the directory to start a chat</p>
              </div>
            )}

            <div className="space-y-2">
              {conversations.map((convo: any) => {
                const name = convo.other?.full_name || 'Member'
                const tableName = (convo.other?.groups as any)?.name
                return (
                  <Link key={convo.id} href={`/dm/${convo.id}`}
                    className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm">
                    <div className="w-11 h-11 rounded-full bg-bt-navy flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold text-sm">{getInitials(name)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{name}</p>
                      {tableName && <p className="text-xs text-bt-blue">{tableName}</p>}
                      {convo.lastMsg && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">{convo.lastMsg.content}</p>
                      )}
                    </div>
                    <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
