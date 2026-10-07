'use client'
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { shrinkImage } from '@/lib/image'

// Photos in every chat (table, group, direct, TC Room). One implementation:
// the camera button, the waiting thumbnail, and the photo in a bubble.
// Files go to the sender's own folder in the chat-photos bucket, shrunk to
// 1600px first (sql/2026-10-07-chat-photos.sql).

export type PhotoAttach = ReturnType<typeof usePhotoAttach>

export function usePhotoAttach(userId: string | null | undefined) {
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function pick(file: File) {
    if (!userId) return
    setError(''); setBusy(true)
    const supabase = createClient()
    const blob = await shrinkImage(file, 1600, 0.82)
    const path = `${userId}/${crypto.randomUUID()}.jpg`
    const { error: upErr } = await supabase.storage.from('chat-photos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false })
    setBusy(false)
    if (upErr) {
      setError(/bucket not found/i.test(upErr.message) ? "Photos aren't switched on yet." : "Couldn't add the photo. Try again.")
      return
    }
    setPhoto(supabase.storage.from('chat-photos').getPublicUrl(path).data.publicUrl)
  }

  return { photo, busy, error, fileRef, pick, clear: () => { setPhoto(null); setError('') }, active: !!(photo || busy || error) }
}

/** The camera button that sits left of the message box. */
export function PhotoButton({ att }: { att: PhotoAttach }) {
  return (
    <>
      <input ref={att.fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) att.pick(f) }} />
      <button type="button" onClick={() => att.fileRef.current?.click()} disabled={att.busy} aria-label="Add a photo"
        className="w-10 h-10 rounded-full bg-bt-pale text-bt-navy flex items-center justify-center flex-shrink-0 disabled:opacity-40">
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </>
  )
}

/** The thumbnail waiting above the box until the next send. */
export function PhotoPreview({ att }: { att: PhotoAttach }) {
  if (!att.active) return null
  return (
    <div className="flex-shrink-0 px-4 pt-3 bg-white border-t border-gray-100 flex items-center gap-3">
      {att.busy && <p className="text-xs text-gray-400">Adding photo...</p>}
      {att.photo && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={att.photo} alt="" className="h-16 w-16 rounded-xl object-cover" />
          <button type="button" onClick={att.clear} aria-label="Remove photo"
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gray-800 text-white text-xs font-bold">×</button>
        </div>
      )}
      {att.error && <p className="text-xs text-red-600">{att.error}</p>}
    </div>
  )
}

/** A sent photo, above the text bubble. Tap for full size. */
export function MessagePhoto({ url }: { url?: string | null }) {
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block mb-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Photo" loading="lazy" className="rounded-2xl max-h-72 w-auto object-cover border border-gray-100" />
    </a>
  )
}
