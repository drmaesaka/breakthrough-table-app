import { createClient } from '@/lib/supabase'

/**
 * The signed-in person's profile row, with `groups: { name, last_period_start }`
 * for their main table (2026-10-28).
 *
 * Reads it in the browser first, as every screen used to; if that comes back
 * empty or errors, asks /api/me (service key). On 2026-10-28 the browser read
 * failed for every user at once and the app lost its Home buttons and Admin
 * tab, because both hinge on this row.
 */
export async function fetchMe(userId: string): Promise<any | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('profiles').select('*, groups(name, last_period_start)').eq('id', userId).maybeSingle()
  if (data && !error) {
    if (data.group_id && !data.groups) return (await fromServer()) || data
    return data
  }
  if (error) console.error('profile read failed, asking the server:', error.message)
  return fromServer()
}

async function fromServer(): Promise<any | null> {
  try {
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
    return res.ok ? (await res.json()).profile : null
  } catch { return null }
}

/**
 * Saves fields on the caller's own profile through /api/me (2026-10-29).
 * Returns an error message, or null once the server confirms the row changed.
 */
export async function saveMe(changes: Record<string, unknown>): Promise<string | null> {
  try {
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify(changes),
    })
    if (res.ok) {
      try { localStorage.removeItem('bt-home-profile') } catch {}
      return null
    }
    return (await res.json().catch(() => ({}))).error || 'Could not save'
  } catch { return 'Could not save — check your connection' }
}
