import { createClient } from '@/lib/supabase'
import type { NotifyKind } from '@/lib/notify'

/**
 * Fire-and-forget: tell the server a row was just written so the people it
 * concerns get a notification. Never awaited by the UI and never surfaces an
 * error — the message or item is already saved; a missed ping is not worth a
 * red banner. keepalive lets it finish if the person closes the app at once.
 */
export async function notifyAbout(kind: NotifyKind, id: string | null | undefined) {
  if (!id) return
  try {
    const { data: { session } } = await createClient().auth.getSession()
    if (!session?.access_token) return
    await fetch('/api/notify', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ kind, id }),
    })
  } catch (err) {
    console.error('notify failed:', err)
  }
}
