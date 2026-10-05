import { createClient } from '@/lib/supabase'

export type MyTable = { id: string; name: string; current_meeting_number: number | null; program_start_date: string | null; home: boolean }

/**
 * The tables a person can switch between on Home and Reflections: the one
 * they sit at first, then every other table they lead (for a super admin,
 * every table). A TC running several could not tell which one those screens
 * showed (2026-10-05). Members, and any failure, get just their own table:
 * the switcher is a convenience, never worth an error.
 */
export async function myTables(home: { id: string; name: string; current_meeting_number?: number | null; program_start_date?: string | null } | null, isLeader: boolean): Promise<MyTable[]> {
  const out: MyTable[] = home ? [{ id: home.id, name: home.name, current_meeting_number: home.current_meeting_number ?? null, program_start_date: home.program_start_date ?? null, home: true }] : []
  if (!isLeader) return out
  try {
    const { data: { session } } = await createClient().auth.getSession()
    if (!session?.access_token) return out
    const res = await fetch('/api/admin/my-groups', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (!res.ok) return out
    const { groups } = await res.json()
    for (const g of groups || []) {
      if (g.id === home?.id) continue
      out.push({ id: g.id, name: g.name, current_meeting_number: g.current_meeting_number ?? null, program_start_date: g.program_start_date ?? null, home: false })
    }
  } catch { /* own table only */ }
  return out
}
