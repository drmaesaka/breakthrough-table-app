import { createClient } from '@/lib/supabase'

/**
 * How many tables a leader runs besides the one they sit at. Home and
 * Reflections only ever show the seated table; a TC running several could
 * not tell which one they were looking at (2026-10-05). Zero for members,
 * and on any failure: the hint is a convenience, never worth an error.
 */
export async function otherLedTableCount(homeGroupId: string | null): Promise<number> {
  try {
    const { data: { session } } = await createClient().auth.getSession()
    if (!session?.access_token) return 0
    const res = await fetch('/api/admin/my-groups', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (!res.ok) return 0
    const { groups } = await res.json()
    return (groups || []).filter((g: any) => g.id !== homeGroupId).length
  } catch {
    return 0
  }
}
