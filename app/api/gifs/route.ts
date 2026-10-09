import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/api-auth'

// GIF search for the chats (2026-10-09), through GIPHY. The key stays on the
// server (GIPHY_API_KEY on Vercel; the repo is public). No key → the chats
// simply do not show the GIF button.
//
// GET ?q=congrats → { enabled, gifs: [{ id, preview, url, width, height }] }
// GET (no q)      → GIPHY's trending GIFs

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const key = process.env.GIPHY_API_KEY
  if (!key) return NextResponse.json({ enabled: false, gifs: [] })
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 50)
  const params = new URLSearchParams({ api_key: key, limit: '24', rating: 'pg-13', bundle: 'messaging_non_clips' })
  if (q) params.set('q', q)
  const res = await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${params}`, { next: { revalidate: 300 } }).catch(() => null)
  if (!res?.ok) return NextResponse.json({ enabled: true, gifs: [], error: 'GIF search is not answering. Try again.' }, { status: 502 })
  const json = await res.json()
  const gifs = (json.data || []).map((g: any) => {
    const show = g.images?.fixed_width || g.images?.downsized
    const send = g.images?.downsized_medium || g.images?.downsized || g.images?.original
    return { id: g.id, preview: show?.url, url: send?.url?.split('?')[0], width: Number(show?.width) || 200, height: Number(show?.height) || 200 }
  }).filter((g: any) => g.preview && g.url)
  return NextResponse.json({ enabled: true, gifs })
}
