'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import BottomNav from '@/components/BottomNav'
import Avatar from '@/components/Avatar'
import PeoplePicker from '@/components/PeoplePicker'

// Chat: group chats and direct messages. Table chat moved to My Table
// (2026-10-07) so each table's page is its home.
export default function MessagesPage() {
  const [tab, setTab] = useState<'groups' | 'dms'>('groups')
  // Custom groups: any set of people, across tables (2026-09-29).
  const [rooms, setRooms] = useState<any[] | null>(null)
  const [roomsError, setRoomsError] = useState('')
  const [creating, setCreating] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomPeople, setRoomPeople] = useState<Set<string>>(new Set())
  const [roomSaving, setRoomSaving] = useState(false)

  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // DM state
  const [conversations, setConversations] = useState<any[]>([])
  const [dmsLoading, setDmsLoading] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    }
  }

  async function fetchRooms() {
    const res = await fetch('/api/rooms', { headers: await authHeaders() })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setRooms([]); setRoomsError(json.error || 'Could not load groups'); return }
    setRoomsError(''); setRooms(json.rooms || [])
  }

  async function createRoom() {
    if (!roomName.trim() || !roomPeople.size) return
    setRoomSaving(true); setRoomsError('')
    const res = await fetch('/api/rooms', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ name: roomName.trim(), member_ids: [...roomPeople] }) })
    const json = await res.json().catch(() => ({}))
    setRoomSaving(false)
    if (!res.ok) { setRoomsError(json.error || 'Could not create the group'); return }
    router.push(`/chat/${json.room.id}`)
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
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (tab === 'dms' && user) fetchDMs(user.id)
    if (tab === 'groups' && user) fetchRooms()
  }, [tab, user])

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
          {(['groups', 'dms'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3.5 py-2 rounded-t-xl text-sm font-semibold transition-colors ${
                tab === t ? 'bg-bt-pale text-bt-navy' : 'text-white/60 hover:text-white/80'
              }`}>
              {t === 'groups' ? '👥 Groups' : '✉️ Direct'}
            </button>
          ))}
        </div>
      </div>

      {/* Who can see this. Leaders asked whether the chat was their table or
          all of BT — nothing on the screen said. Table chat is one table;
          DMs reach anyone in the BT community. */}
      <div className="bg-bt-pale px-5 pt-3 pb-1 flex-shrink-0 space-y-2">
        <p className="text-xs text-gray-500">
          {tab === 'groups'
            ? <>Groups you create with anyone in BT, from any table. Only the people in a group see it.</>
            : <>Private one-to-one messages with anyone in the BT community, any table.</>}
        </p>
        <p className="text-xs text-gray-500">
          Looking for your table&apos;s chat? It&apos;s on <Link href="/group" className="text-bt-blue font-semibold">My Table</Link>.
        </p>
      </div>

      {/* Groups Tab — custom rooms across tables */}
      {tab === 'groups' && (
        <div className="flex-1 overflow-y-auto pb-36">
          <div className="px-5 py-4 space-y-3">
            {!creating ? (
              <button onClick={() => setCreating(true)}
                className="w-full flex items-center gap-3 bg-bt-navy text-white px-4 py-3.5 rounded-2xl font-semibold text-sm">
                <span className="text-xl">➕</span>
                <div className="text-left">
                  <p className="font-semibold">New group</p>
                  <p className="text-white/60 text-xs font-normal mt-0.5">Pick anyone, from any table</p>
                </div>
              </button>
            ) : (
              <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-bt-navy">New group</p>
                  <button onClick={() => { setCreating(false); setRoomName(''); setRoomPeople(new Set()) }} className="text-xs text-gray-400 font-semibold">Cancel</button>
                </div>
                <input autoFocus value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="Group name, e.g. Pickleball crew"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue" />
                <PeoplePicker selected={roomPeople} onChange={setRoomPeople} />
                {roomsError && <p className="text-xs text-red-600">{roomsError}</p>}
                <button onClick={createRoom} disabled={roomSaving || !roomName.trim() || !roomPeople.size}
                  className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                  {roomSaving ? 'Creating...' : roomPeople.size ? `Create with ${roomPeople.size} ${roomPeople.size === 1 ? 'person' : 'people'}` : 'Pick at least one person'}
                </button>
              </div>
            )}

            {rooms === null && <p className="text-center text-gray-400 py-8">Loading...</p>}
            {rooms !== null && roomsError && !creating && <p className="text-center text-red-600 text-xs">{roomsError}</p>}
            {rooms !== null && rooms.length === 0 && !roomsError && !creating && (
              <div className="text-center py-12">
                <p className="text-4xl mb-3">👥</p>
                <p className="text-gray-500 font-medium">No groups yet</p>
                <p className="text-gray-400 text-sm mt-1">Start one for any few people who need their own thread.</p>
              </div>
            )}
            {(rooms || []).map(r => (
              <Link key={r.id} href={`/chat/${r.id}`} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm">
                <div className="w-11 h-11 rounded-full bg-bt-navy flex items-center justify-center flex-shrink-0 text-white text-lg">👥</div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{r.name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {r.last_message ? (r.last_message.content || '📷 Photo') : r.members.map((m: any) => m.full_name.split(' ')[0]).join(', ')}
                  </p>
                </div>
                <span className="text-xs text-gray-300 flex-shrink-0">{r.members.length}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* DMs Tab */}
      {tab === 'dms' && (
        <div className="flex-1 overflow-y-auto pb-36">
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
                        <p className="text-xs text-gray-400 truncate mt-0.5">{convo.lastMsg.content || '📷 Photo'}</p>
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
