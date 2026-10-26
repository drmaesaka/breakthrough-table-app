import { adminClient } from '@/lib/api-auth'

// Extra tables (2026-10-26; sql/2026-10-26-extra-tables.sql). profiles.group_id
// is a person's main table; table_memberships adds others. SERVER ONLY.
// Every helper answers "none" if the table does not exist yet, so the app
// behaves as before until the migration runs.

/** Tables this person belongs to besides their main one. */
export async function extraTablesOf(userId: string): Promise<string[]> {
  const { data, error } = await adminClient().from('table_memberships').select('group_id').eq('user_id', userId)
  if (error) return []
  return (data || []).map(r => r.group_id as string)
}

/** Main table plus extra tables. */
export async function tablesOf(userId: string): Promise<string[]> {
  const [{ data: prof }, extra] = await Promise.all([
    adminClient().from('profiles').select('group_id').eq('id', userId).maybeSingle(),
    extraTablesOf(userId),
  ])
  return [...new Set([...(prof?.group_id ? [prof.group_id as string] : []), ...extra])]
}

/** Everyone at these tables: seated there (main table) or added as an extra table. */
export async function peopleAtTables(groupIds: string[]): Promise<string[]> {
  if (!groupIds.length) return []
  const admin = adminClient()
  const [{ data: seated }, { data: extra, error }] = await Promise.all([
    admin.from('profiles').select('id').in('group_id', groupIds),
    admin.from('table_memberships').select('user_id').in('group_id', groupIds),
  ])
  return [...new Set([...(seated || []).map(p => p.id as string), ...(error ? [] : (extra || []).map(r => r.user_id as string))])]
}

/** userId → extra table ids, for a set of people. */
export async function extraTablesFor(userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!userIds.length) return out
  const { data, error } = await adminClient().from('table_memberships').select('user_id, group_id').in('user_id', userIds)
  if (error) return out
  for (const r of data || []) out.set(r.user_id, [...(out.get(r.user_id) || []), r.group_id])
  return out
}
