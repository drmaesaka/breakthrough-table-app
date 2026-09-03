'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { notifyAbout } from '@/lib/notify-client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import BottomNav from '@/components/BottomNav'
import Avatar from '@/components/Avatar'
import { ledGroups } from '@/lib/leader-groups'

export default function MessagesPage() {
  const [tab, setTab] = useState<'table' | 'dms'>('table')

  // Table chat state
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  /**
   * Every table this person can chat in: the one they sit at, plus any they
   * lead. A TC running two tables used to see only the one they sat at and
   * had no way to reach the other. More than one → a picker appears.
   */
  const [tables, setTables] = useState<{ id: string; name: string }[]>([])
  /** The table they sit at. Its chat goes browser→Supabase; the others via /api/messages. */
  const homeGroupIdRef = useRef<string | null>(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const groupIdRef = useRef<string | null>(null)
  const lastCountRef = useRef<string | number | null>(0)
  const newestSeenRef = useRef<string | null>(null)

  // DM state
  const [conversations, setConversations] = useState<any[]>([])
  const [dmsLoading, setDmsLoading] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  async function fetchMessages(gid: string) {
    // First load: the newest 200, flipped for display. Every poll after that
    // asks only for rows newer than what's on screen — the old full refetch
    // every 3 seconds re-downloaded the entire history per tick per open tab,
    // which is the kind of traffic that burns through Supabase's free egress
    // quota and starts failing reads app-wide.
    const newestSeen = newestSeenRef.current

    // A table the leader runs but does not sit at. RLS scopes the browser's
    // reads to their own table, so this goes through the server instead.
    if (gid !== homeGroupIdRef.current) {
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
      // Keep what is on screen if a poll fails. `setMessages(data || [])` wiped
      // the whole conversation to the "Say hello to your table!" empty state on
      // any transient error, three seconds at a time.
      if (error || !page) {
        if (error) console.error('messages fetch failed:', error.message)
        return
      }
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
    newestSeenRef.current = fresh[fresh.length - 1].created_at
    setMessages(prev => {
      // Guard against a race double-appending the same rows.
      const seen = new Set(prev.map(m => m.id))
      return [...prev, ...fresh.filter(m => !seen.has(m.id))]
    })
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    }
  }

  /** Switches the Table Chat tab to another of this person's tables. */
  async function switchTable(gid: string) {
    if (gid === groupIdRef.current) return
    const t = tables.find(x => x.id === gid)
    setGroupId(gid)
    setGroupName(t?.name || 'Table')
    groupIdRef.current = gid
    newestSeenRef.current = null
    lastCountRef.current = 0
    setMessages([])
    setSendError(false)
    await fetchMessages(gid)
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
        .select('full_name, group_id, avatar_url, groups(name)')
        .eq('id', otherId)
        .single()
      // Get latest message
      const { data: lastMsg } = await supabase
        .from('direct_messages')
        .select('content, created_at')
        .eq('conversation_id', convo.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
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
        .select('group_id, role, groups(name)')
        .eq('id', user.id)
        .single()

      const home = profile?.group_id
        ? { id: profile.group_id as string, name: (profile.groups as any)?.name || 'Group Chat' }
        : null
      homeGroupIdRef.current = home?.id || null

      // Leaders also get the tables they run. Own table first, so nothing
      // changes for a TC with one table.
      const led = profile?.role === 'leader' ? await ledGroups(supabase, user.id, 'id, name, leader_id') : []
      const all = [...(home ? [home] : []), ...led.filter(g => g.id !== home?.id).map(g => ({ id: g.id, name: g.name }))]
      setTables(all)

      const first = all[0]
      if (first) {
        setGroupId(first.id)
        setGroupName(first.name)
        groupIdRef.current = first.id
        await fetchMessages(first.id)
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

  // Scroll only when a message actually arrives. The 3s poll hands back a new
  // array object every time, so depending on `messages` re-scrolled on a loop
  // and made it impossible to read back through the conversation. Keyed by the
  // newest message id, not the count — once the 200-message window is full the
  // count never changes again.
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null
    if (lastId === lastCountRef.current) return
    lastCountRef.current = lastId
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (tab === 'dms' && user) fetchDMs(user.id)
  }, [tab, user])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMessage.trim() || !groupId || !user || sending) return
    const text = newMessage.trim()
    setSending(true)
    let error: { message: string } | null = null
    if (groupId !== homeGroupIdRef.current) {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ group_id: groupId, content: text }),
      })
      if (!res.ok) error = { message: `send failed (${res.status})` }
    } else {
      const r = await supabase.from('messages').insert({
        group_id: groupId,
        user_id: user.id,
        content: text,
      }).select('id').single()
      error = r.error
      if (!r.error) notifyAbout('chat', r.data?.id)
    }
    setSending(false)
    // Keep the member's text in the box if the send failed — clearing it
    // unconditionally destroyed what they had written.
    if (error) {
      console.error('message send failed:', error.message)
      setSendError(true)
      return
    }
    setSendError(false)
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
              {t === 'table' ? '💬 Table Chat' : '✉️ Direct Messages'}
            </button>
          ))}
        </div>
      </div>

      {/* Who can see this. Leaders asked whether the chat was their table or
          all of BT — nothing on the screen said. Table chat is one table;
          DMs reach anyone in the BT community. */}
      <div className="bg-bt-pale px-5 pt-3 pb-1 flex-shrink-0 space-y-2">
        {tab === 'table' && tables.length > 1 && (
          <label className="block">
            <span className="text-[11px] text-gray-400 font-medium">Chatting with</span>
            <select value={groupId || ''} onChange={e => switchTable(e.target.value)}
              className="mt-0.5 w-full bg-white text-bt-navy text-sm font-semibold rounded-xl px-3 py-2 border border-gray-200 focus:outline-none">
              {tables.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.id === homeGroupIdRef.current ? ' (your table)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="text-xs text-gray-500">
          {tab === 'table'
            ? <>🔒 <span className="font-semibold text-bt-navy">{groupName || 'Your table'}</span> only. Just the people at this table can see this.</>
            : <>Private one-to-one messages with anyone in the BT community, any table.</>}
        </p>
      </div>

      {/* Table Chat */}
      {tab === 'table' && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-16">
                <p className="text-4xl mb-3">💬</p>
                <p className="text-gray-500 font-medium">No messages yet</p>
                <p className="text-gray-400 text-sm mt-1">Say hello to your tablemates! Only your table sees this.</p>
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
                placeholder={groupId === homeGroupIdRef.current ? "Message your table..." : `Message ${groupName}...`}
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
                <p className="text-white/60 text-xs font-normal mt-0.5">Message anyone in BT, from any table</p>
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
                <p className="text-gray-400 text-sm mt-1">Find anyone in the BT community in the directory to start a chat</p>
              </div>
            )}

            <div className="space-y-2">
              {conversations.map((convo: any) => {
                const name = convo.other?.full_name || 'Member'
                const tableName = (convo.other?.groups as any)?.name
                return (
                  <Link key={convo.id} href={`/dm/${convo.id}`}
                    className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm">
                    <Avatar src={convo.other?.avatar_url} name={name} className="w-11 h-11 bg-bt-navy" textClass="text-white font-bold text-sm" />
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
