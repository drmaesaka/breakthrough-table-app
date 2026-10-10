'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import SunriseLibrary from '@/components/SunriseLibrary'

const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string; icon: string }> = {
  video:   { label: 'Video',   bg: 'bg-red-50',    text: 'text-red-500',    icon: '▶' },
  pdf:     { label: 'PDF',     bg: 'bg-orange-50', text: 'text-orange-500', icon: '📄' },
  article: { label: 'Article', bg: 'bg-blue-50',   text: 'text-blue-500',   icon: '📰' },
  link:    { label: 'Link',    bg: 'bg-purple-50', text: 'text-purple-500', icon: '🔗' },
}

function getYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

function ContentCard({ item, onRemove }: { item: any; onRemove?: () => void }) {
  const ytId = item.url ? getYouTubeId(item.url) : null
  const thumbUrl = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null
  // Uploaded documents are saved as type "link" (the only types the table
  // knows are video/pdf/article/link); badge them by file extension instead.
  const isDoc = item.type === 'link' && /\.(docx?|pptx?|xlsx?|txt|rtf|pages|key|numbers)(\?|$)/i.test(item.url || '')
  const isImage = item.type === 'link' && /\.(png|jpe?g|gif|webp|heic)(\?|$)/i.test(item.url || '')
  const cfg = isDoc
    ? { label: 'Document', bg: 'bg-emerald-50', text: 'text-emerald-600', icon: '📎' }
    : isImage
      ? { label: 'Image', bg: 'bg-pink-50', text: 'text-pink-500', icon: '🖼' }
      : TYPE_CONFIG[item.type] || TYPE_CONFIG.link

  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className="block bg-white rounded-2xl shadow-sm overflow-hidden active:opacity-80 transition-opacity">

      {/* Thumbnail for YouTube videos */}
      {thumbUrl && (
        <div className="relative w-full aspect-video bg-gray-100 overflow-hidden">
          <img src={thumbUrl} alt={item.title}
            className="w-full h-full object-cover" />
          {/* Play button overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
              <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          </div>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Type badge */}
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${cfg.bg} ${cfg.text}`}>
              <span className="text-[10px]">{cfg.icon}</span> {cfg.label}
            </span>
            <p className="font-semibold text-gray-900 text-sm leading-snug">{item.title}</p>
            {Date.now() - new Date(item.created_at).getTime() < 7 * 86400000 && (
              <span className="inline-block mt-1 bg-bt-blue text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold">New</span>
            )}
            {item.description && (
              <p className="text-gray-400 text-xs mt-1.5 leading-relaxed line-clamp-2">{item.description}</p>
            )}
          </div>
          {/* Only show icon if no thumbnail */}
          {/* TCs: remove it from the table without a trip to Admin (2026-10-10). */}
          {onRemove && (
            <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove() }}
              className="text-red-400 text-xs font-semibold flex-shrink-0 mt-0.5">Remove</button>
          )}
          {!thumbUrl && !onRemove && (
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          )}
        </div>
      </div>
    </a>
  )
}

export default function LibraryPage() {
  // The table's own items, newest first. "Current / Previous Assignments"
  // went 2026-10-10: assignments live in Reading & Resources and Follow-ups,
  // and the split hinged on a period date tables rarely kept up.
  const [items, setItems] = useState<any[]>([])
  const [isLeader, setIsLeader] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase
        .from('profiles')
        .select('group_id, role')
        .eq('id', user.id)
        .single()

      setIsLeader(prof?.role === 'leader')
      if (!prof?.group_id) { setLoading(false); return }

      const { data: contentData } = await supabase
        .from('content')
        .select('*')
        .eq('group_id', prof.group_id)
        .order('created_at', { ascending: false })

      setItems(contentData || [])
      setLoading(false)
    }
    load()
  }, [router])

  async function removeItem(item: any) {
    const { data: { session } } = await createClient().auth.getSession()
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` }
    // Same as Admin → Library: something posted to several tables can go from all of them.
    const pre = await fetch('/api/admin/post-item', { method: 'DELETE', headers, body: JSON.stringify({ table: 'content', id: item.id, count: true }) })
    const info = await pre.json().catch(() => ({}))
    let all = false
    if (pre.ok && info.copies > 1) {
      if (confirm(`"${item.title}" is on ${info.copies} tables (${(info.tables || []).join(', ')}). Remove it from all of them?`)) all = true
      else if (!confirm('Remove it from just this table, then?')) return
    } else if (!confirm(`Remove "${item.title}" from the Library?`)) return
    const res = await fetch('/api/admin/post-item', { method: 'DELETE', headers, body: JSON.stringify({ table: 'content', id: item.id, all }) })
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || 'Could not remove it.'); return }
    setItems(p => p.filter(x => x.id !== item.id))
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Library</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">Resources & videos</p>
      </div>

      <div className="px-5 py-5 pb-36 space-y-5">


        {items.length > 0 && (
          <div>
            <p className="text-xs font-bold text-bt-navy uppercase tracking-wide mb-3 px-1">From your TC</p>
            <div className="space-y-3">
              {items.map(item => <ContentCard key={item.id} item={item} onRemove={isLeader ? () => removeItem(item) : undefined} />)}
            </div>
          </div>
        )}

        <SunriseLibrary />
      </div>

      <BottomNav />
    </div>
  )
}
