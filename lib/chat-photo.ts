/**
 * A photo URL is accepted server-side only if it is in the sender's own
 * chat-photos folder, or is a GIF picked from GIPHY's search (2026-10-09,
 * components/GifPicker.tsx) — those are served from GIPHY's own media hosts.
 */
export function isOwnChatPhoto(url: unknown, userId: string): url is string {
  return typeof url === 'string'
    && (url.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chat-photos/${userId}/`)
      || isGiphyUrl(url))
}

export function isGiphyUrl(url: string): boolean {
  return /^https:\/\/(media\d*|i)\.giphy\.com\/[A-Za-z0-9/._?=&-]+$/.test(url)
}
