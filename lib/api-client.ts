import { createClient } from '@/lib/supabase'

/**
 * POSTs to one of our own routes with the caller's token (2026-10-29).
 * Saves go through the server so a database policy cannot drop them quietly:
 * a browser update or delete that a policy filters to zero rows reports
 * success while changing nothing.
 */
export async function postApi<T = any>(path: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    return res.ok ? { data: json, error: null } : { data: null, error: json.error || `Request failed (${res.status})` }
  } catch {
    return { data: null, error: 'Could not reach the server — check your connection' }
  }
}
