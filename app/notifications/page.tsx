'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import { useReactions, PostReactions } from '@/components/Reactions'

type Item = { id: string; kind: string; title: string; body: string; url: string; created_at: string; read_at: string | null; post_id?: string | null }

// The 🔔 inbox: everything the app has notified me about, newest first, so a
// swiped-away banner — or no push at all — does not mean missing it.
export default function NotificationsPage() {
  const [items, setItems] = useState<Item[]>([])
  // Announcements can be reacted to (2026-10-09); they share a post_id across recipients.
  const rx = useReactions('announcement', items.map(n => n.post_id || '').filter(Boolean))
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const router = useRouter()

  async function headers(): Promise<Record<string, string>> {
    const { data: { session } } = await createClient().auth.getSession()
    return { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' }
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await createClient().auth.getUser()
      if (!user) { router.push('/login'); return }
      const res = await fetch('/api/notifications', { headers: await headers() }).catch(() => null)
      if (!res || !res.ok) { setFailed(true); setLoading(false); return }
      const j = await res.json()
      setItems(j.items || [])
      setLoading(false)
      // Opening the inbox counts as seeing them. Unread ones keep their dot
      // for this visit so it is clear what was new.
      if (j.unread) fetch('/api/notifications', { method: 'POST', headers: await headers(), body: JSON.stringify({ all: true }) })
    }
    load()
  }, [router])

  function when(iso: string) {
    const d = new Date(iso)
    const mins = Math.round((Date.now() - d.getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
    if (mins < 60 * 24 * 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Notifications</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">Everything the app has sent you</p>
      </div>

      <div className="px-5 py-5 pb-36 space-y-2">
        {loading && <p className="text-center text-gray-400 py-10">Loading...</p>}
        {failed && <p className="text-center text-gray-400 py-10">Couldn&apos;t load notifications. Close and reopen the app to try again.</p>}
        {!loading && !failed && items.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">🔔</p>
            <p className="text-gray-500 font-medium">Nothing yet</p>
            <p className="text-gray-400 text-sm mt-1">New messages, reading and updates from your table will show up here.</p>
          </div>
        )}
        {items.map(n => (
          // A div, not a button: an announcement holds reaction buttons.
          <div key={n.id} role="button" onClick={() => router.push(n.url || '/dashboard')}
            className={`w-full text-left rounded-2xl px-4 py-3 shadow-sm flex gap-3 cursor-pointer ${n.read_at ? 'bg-white' : 'bg-white ring-2 ring-bt-blue/30'}`}>
            <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-bt-blue'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-bt-navy truncate">{n.title}</p>
                <span className="text-[11px] text-gray-400 flex-shrink-0">{when(n.created_at)}</span>
              </div>
              {n.body && <p className="text-sm text-gray-600 mt-0.5 line-clamp-2 break-words">{n.body}</p>}
              {n.post_id && <PostReactions id={n.post_id} state={rx} />}
            </div>
          </div>
        ))}
      </div>
      <BottomNav />
    </div>
  )
}
