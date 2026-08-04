import type { SupabaseClient } from '@supabase/supabase-js'

// Which tables the signed-in leader can act on, read from the browser.
//
// The server-side equivalent is leaderGroupIds() in lib/api-auth.ts. Both
// resolve the same union — the group_leaders join table added 2026-08-03, plus
// the legacy groups.leader_id column — and they have to agree, or a leader sees
// a table in the picker whose API calls then return 403.
//
// A table used to have exactly one leader. That made every TC a single point of
// failure for their own table: away for a week and nobody could start a period,
// edit the meeting outline or send a broadcast.

export type LedGroup = { id: string; name: string; leader_id: string | null }

/**
 * Tables this user leads, by name.
 *
 * Returns an empty array rather than throwing, matching how these pages already
 * treat "no tables" — a leader with none sees the empty state, not an error.
 * Tolerates group_leaders not existing yet so the page still works if the code
 * deploys ahead of the migration.
 */
export async function ledGroups(
  supabase: SupabaseClient,
  userId: string,
  columns = 'id, name, leader_id'
): Promise<LedGroup[]> {
  const { data: memberships } = await supabase
    .from('group_leaders')
    .select('group_id')
    .eq('user_id', userId)

  const coLedIds = (memberships || []).map(m => m.group_id as string)

  let query = supabase.from('groups').select(columns)
  if (coLedIds.length) {
    // PostgREST `in` takes a bare parenthesised list. The ids are uuids straight
    // from the database, so there is nothing to escape, but the list is built
    // rather than interpolated from user input for that reason.
    query = query.or(`leader_id.eq.${userId},id.in.(${coLedIds.join(',')})`)
  } else {
    query = query.eq('leader_id', userId)
  }

  const { data, error } = await query.order('name', { ascending: true })
  if (error) {
    console.error('could not load led groups:', error.message)
    return []
  }
  return (data || []) as unknown as LedGroup[]
}
