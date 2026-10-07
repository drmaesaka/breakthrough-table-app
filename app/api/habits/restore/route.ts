import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// "Unmaster" a habit: bring a graduated habit back into the daily list.
// Server-side with the service key because habit_history's delete policy
// lives in the console and a filtered delete would report success while
// leaving the badge in place.
//
// History rows carry the habit's NAME, not its id, so the archived habit
// row is found by name; clearing archived_at restores its whole check-in
// history and streak. If no archived row exists (pre-2026-08-24 history),
// a fresh habit is created instead.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { history_id } = await req.json().catch(() => ({}))
  if (!history_id) return NextResponse.json({ error: 'history_id is required' }, { status: 400 })

  const admin = adminClient()
  const { data: row } = await admin.from('habit_history').select('id, user_id, habit_name').eq('id', history_id).maybeSingle()
  if (!row || row.user_id !== auth.userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: archived } = await admin
    .from('habits').select('id')
    .eq('user_id', auth.userId).eq('name', row.habit_name).not('archived_at', 'is', null)
    .order('archived_at', { ascending: false }).limit(1).maybeSingle()

  let habit
  if (archived) {
    const r = await admin.from('habits').update({ archived_at: null }).eq('id', archived.id).select().single()
    if (r.error) return NextResponse.json({ error: 'Could not restore', detail: r.error.message }, { status: 500 })
    habit = r.data
  } else {
    const r = await admin.from('habits').insert({ user_id: auth.userId, name: row.habit_name }).select().single()
    if (r.error) return NextResponse.json({ error: 'Could not restore', detail: r.error.message }, { status: 500 })
    habit = r.data
  }
  // Every badge for this habit name, not just the one tapped: a habit installed
  // twice left the other badge saying "installed" while it was back in use.
  const { error } = await admin.from('habit_history').delete().eq('user_id', auth.userId).eq('habit_name', row.habit_name)
  if (error) return NextResponse.json({ error: 'Restored, but the badge would not clear', detail: error.message }, { status: 500 })
  return NextResponse.json({ habit })
}
