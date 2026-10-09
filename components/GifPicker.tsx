'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import type { PhotoAttach } from '@/components/ChatPhoto'

// The GIF button beside the camera in every chat (2026-10-09): search GIPHY,
// tap one, and it waits above the message box like a photo until Send. Only
// shown once /api/gifs says a GIPHY key is set.

type Gif = { id: string; preview: string; url: string; width: number; height: number }

let enabledCache: boolean | null = null

async function get(q: string) {
  const { data: { session } } = await createClient().auth.getSession()
  const res = await fetch(`/api/gifs${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
    headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
  }).catch(() => null)
  return res ? await res.json().catch(() => ({})) : {}
}

export function GifButton({ att }: { att: PhotoAttach }) {
  const [enabled, setEnabled] = useState<boolean | null>(enabledCache)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (enabledCache !== null) return
    get('').then(j => { enabledCache = Boolean(j.enabled); setEnabled(enabledCache) })
  }, [])

  if (!enabled) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={att.busy} aria-label="Add a GIF"
        className="h-10 px-2.5 rounded-full bg-bt-pale text-bt-navy text-xs font-extrabold flex-shrink-0 disabled:opacity-40">
        GIF
      </button>
      {open && <GifSheet onClose={() => setOpen(false)} onPick={url => { att.setPhoto(url); setOpen(false) }} />}
    </>
  )
}

function GifSheet({ onClose, onPick }: { onClose: () => void; onPick: (url: string) => void }) {
  const [q, setQ] = useState('')
  const [gifs, setGifs] = useState<Gif[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const seq = useRef(0)

  // Search as they type, a beat after they stop.
  useEffect(() => {
    const n = ++seq.current
    const t = setTimeout(async () => {
      setLoading(true)
      const j = await get(q.trim())
      if (n !== seq.current) return
      setGifs(j.gifs || []); setError(j.error || ''); setLoading(false)
    }, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl p-4 space-y-3 max-h-[75dvh] flex flex-col" onClick={e => e.stopPropagation()}
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Search GIFs"
            className="flex-1 bg-bt-pale rounded-full px-4 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue" />
          <button type="button" onClick={onClose} className="text-sm font-semibold text-gray-500 px-2">Cancel</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {error && <p className="text-xs text-red-600 py-2">{error}</p>}
          {!loading && !error && gifs.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No GIFs found</p>}
          <div className="columns-2 gap-2">
            {gifs.map(g => (
              <button key={g.id} type="button" onClick={() => onPick(g.url)} className="block w-full mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.preview} alt="" loading="lazy" className="w-full rounded-xl bg-gray-100"
                  style={{ aspectRatio: `${g.width} / ${g.height}` }} />
              </button>
            ))}
          </div>
          {loading && <p className="text-xs text-gray-400 text-center py-2">Loading...</p>}
        </div>
        <p className="text-[10px] text-gray-400 text-center font-semibold tracking-wide">Powered by GIPHY</p>
      </div>
    </div>
  )
}
