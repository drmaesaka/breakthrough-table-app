'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function MessagesPage() {
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [user, setUser] = useState<any>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
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
        .select('group_id, full_name')
        .eq('id', user.id)
        .single()

      if (profile?.group_id) {
        setGroupId(profile.group_id)
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
      if (groupIdRef.current) {
        fetchMessages(groupIdRef.current)
      }
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

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-700">Loading...</div>

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Breakthrough Table</h1>
        <a href="/dashboard" className="text-sm text-blue-600 hover:underline">← Dashboard</a>
      </nav>

      <main className="max-w-3xl w-full mx-auto px-6 py-6 flex flex-col flex-1">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">Group Chat</h2>

        <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col gap-4 overflow-y-auto min-h-[400px] max-h-[500px]">
          {messages.length === 0 ? (
            <p className="text-gray-500 text-sm text-center mt-auto mb-auto">No messages yet. Say hello!</p>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex flex-col ${msg.user_id === user?.id ? 'items-end' : 'items-start'}`}>
                <span className="text-xs font-semibold text-gray-600 mb-1">
                  {msg.profiles?.full_name || 'Member'}
                </span>
                <div className={`px-4 py-2 rounded-2xl text-sm font-medium max-w-xs ${
                  msg.user_id === user?.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-900'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {!groupId ? (
          <p className="text-gray-600 text-sm text-center mt-4">You need to be assigned to a group to chat.</p>
        ) : (
          <form onSubmit={sendMessage} className="mt-4 flex gap-3">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 border border-gray-300 rounded-xl px-4 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition"
            >
              Send
            </button>
          </form>
        )}
      </main>
    </div>
  )
}