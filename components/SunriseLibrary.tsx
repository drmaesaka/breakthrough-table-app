'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { linkify } from '@/lib/linkify'
import type { SunriseItem } from '@/lib/sunrise-library'

// Library's "From Sunrise Network" section: everything posted on Sunrise that
// this person may see (decided server-side, /api/library/sunrise), opened
// right here — videos play, documents open in a viewer, articles show their
// text. No Sunrise login.

const KIND = {
  video:    { label: 'Video',    icon: '▶', cls: 'bg-red-50 text-red-500' },
  document: { label: 'Document', icon: '📄', cls: 'bg-emerald-50 text-emerald-600' },
  article:  { label: 'Article',  icon: '📰', cls: 'bg-blue-50 text-blue-500' },
} as const

function ytId(url: string | null): string | null {
  return url?.match(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/)?.[1] || null
}

/** PDFs open as they are; Office files through Microsoft's no-sign-in viewer. */
function docViewer(url: string): string | null {
  if (/\.pdf(\?|$)/i.test(url)) return url
  if (/\.(docx?|pptx?|xlsx?)(\?|$)/i.test(url)) return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
  return null
}

export default function SunriseLibrary() {
  const [items, setItems] = useState<SunriseItem[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | SunriseItem['kind']>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<SunriseItem | null>(null)
  const [shown, setShown] = useState(20)

  useEffect(() => {
    (async () => {
      const { data: { session } } = await createClient().auth.getSession()
      const res = await fetch('/api/library/sunrise', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } }).catch(() => null)
      if (!res || !res.ok) { setError("Couldn't load Sunrise Network content right now."); setItems([]); return }
      setItems((await res.json()).items || [])
    })()
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items || []).filter(i => (filter === 'all' || i.kind === filter)
      && (!q || i.title.toLowerCase().includes(q) || (i.author || '').toLowerCase().includes(q) || i.summary.toLowerCase().includes(q)))
  }, [items, filter, query])

  if (items === null) return <p className="text-center text-gray-400 text-sm py-6">Loading Sunrise Network content...</p>
  if (!items.length && !error) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-xs font-bold text-bt-navy uppercase tracking-wide">From Sunrise Network</span>
        <span className="text-xs text-gray-400">{items.length}</span>
      </div>
      {error && <p className="text-xs text-red-600 px-1 mb-2">{error}</p>}

      <input value={query} onChange={e => { setQuery(e.target.value); setShown(20) }} placeholder="Search videos, documents, articles..."
        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue mb-2" />
      <div className="flex gap-2 mb-3 overflow-x-auto">
        {(['all', 'video', 'document', 'article'] as const).map(k => (
          <button key={k} onClick={() => { setFilter(k); setShown(20) }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${filter === k ? 'bg-bt-navy text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>
            {k === 'all' ? 'All' : KIND[k].label + 's'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {visible.slice(0, shown).map(item => {
          const thumb = item.kind === 'video' && ytId(item.url) ? `https://img.youtube.com/vi/${ytId(item.url)}/mqdefault.jpg` : item.cover
          return (
            <button key={item.id} onClick={() => setOpen(item)}
              className="w-full text-left bg-white rounded-2xl shadow-sm p-3 flex gap-3 items-start active:opacity-80">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt="" loading="lazy" className="w-24 h-14 rounded-lg object-cover flex-shrink-0 bg-gray-100" />
              ) : (
                <div className={`w-14 h-14 rounded-lg flex items-center justify-center text-xl flex-shrink-0 ${KIND[item.kind].cls}`}>{KIND[item.kind].icon}</div>
              )}
              <div className="min-w-0 flex-1">
                <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${KIND[item.kind].cls}`}>{KIND[item.kind].label}</span>
                <p className="font-semibold text-gray-900 text-sm leading-snug mt-0.5 line-clamp-2">{item.title}</p>
                {item.author && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{item.author}</p>}
              </div>
            </button>
          )
        })}
        {visible.length === 0 && <p className="text-center text-gray-400 text-sm py-6">Nothing matches.</p>}
        {visible.length > shown && (
          <button onClick={() => setShown(n => n + 20)} className="w-full py-3 text-sm font-semibold text-bt-blue">
            Show more ({visible.length - shown} left)
          </button>
        )}
      </div>

      {open && <Viewer item={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Viewer({ item, onClose }: { item: SunriseItem; onClose: () => void }) {
  const doc = item.kind === 'document' && item.url ? docViewer(item.url) : null
  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col">
      <div className="bg-bt-navy px-4 pb-3 flex items-start gap-3 flex-shrink-0"
        style={{ paddingTop: 'max(1rem, calc(env(safe-area-inset-top) + 0.5rem))' }}>
        <button onClick={onClose} aria-label="Close" className="text-white text-2xl leading-none px-1">×</button>
        <div className="min-w-0">
          <p className="text-white font-semibold leading-snug">{item.title}</p>
          {item.author && <p className="text-bt-light/70 text-xs mt-0.5">{item.author}</p>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {item.kind === 'video' && (item.url ? (
          <div className="w-full aspect-video bg-black">
            <iframe src={item.url} title={item.title} className="w-full h-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          </div>
        ) : (
          <p className="p-5 text-sm text-gray-500">This video hasn&apos;t been linked in the app yet. Your TC can add it in Admin.</p>
        ))}

        {item.kind === 'document' && (doc ? (
          <iframe src={doc} title={item.title} className="w-full h-full min-h-[70vh] border-0" />
        ) : (
          <p className="p-5 text-sm text-gray-500">This file can&apos;t be previewed here. Use “Open the file” below.</p>
        ))}

        {(item.kind === 'article' ? item.body : item.summary) && (
          <div className="p-5 text-sm text-gray-800 leading-relaxed whitespace-pre-line break-words">
            {linkify(item.kind === 'article' ? item.body : item.summary)}
          </div>
        )}
      </div>

      {item.kind === 'document' && item.url && (
        <div className="flex-shrink-0 border-t border-gray-100 p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            className="block text-center w-full py-3 rounded-xl bg-bt-navy text-white text-sm font-semibold">Open the file</a>
        </div>
      )}
    </div>
  )
}
