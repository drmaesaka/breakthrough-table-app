import { createClient } from '@/lib/supabase'

/** The caller's own table, from /api/my-table (see there for why it is server-side). */
export async function fetchMyTable(): Promise<{ id: string; name: string; last_period_start: string | null } | null> {
  try {
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch('/api/my-table', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
    return res.ok ? (await res.json()).table : null
  } catch { return null }
}
