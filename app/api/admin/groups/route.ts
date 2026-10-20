import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'

// Deleting a table (2026-10-20), from Admin → Tables. Only a TC of that table.
//
// DELETE { group_id, confirm_name }
//   confirm_name must match the table's name — a typed check, because this
//   cannot be undone. People seated there keep their accounts and become
//   unassigned; rooms the table owned become shared. Everything that only
//   existed for the table goes with it: its chat, reading and completions,
//   library items, prompts and answers, table-only events and their RSVPs,
//   follow-ups, attendance, invite link, TC list and settings.
//
// Several of these tables were made in the Supabase console, so their
// foreign keys cannot be read from the repo; the rows are removed child
// first rather than trusting ON DELETE CASCADE.

export const maxDuration = 60

export async function DELETE(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { group_id, confirm_name } = await req.json().catch(() => ({}))
  const gid = String(group_id || '')
  if (!(await leaderGroupIds(auth.userId)).includes(gid)) {
    return NextResponse.json({ error: 'You can only delete tables you lead' }, { status: 403 })
  }
  const admin = adminClient()
  const { data: group } = await admin.from('groups').select('id, name').eq('id', gid).maybeSingle()
  if (!group) return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  if (String(confirm_name || '').trim() !== String(group.name).trim()) {
    return NextResponse.json({ error: `Type the table's name exactly ("${group.name}") to delete it` }, { status: 400 })
  }

  const ids = async (table: string, col = 'group_id') =>
    ((await admin.from(table).select('id').eq(col, gid)).data || []).map((r: any) => r.id as string)
  // A missing table (an older install) is not a reason to stop.
  const step = async (label: string, run: () => PromiseLike<{ error: any }>) => {
    const { error } = await run()
    if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(`${label}: ${error.message}`)
  }

  try {
    const [taskIds, promptIds, messageIds, eventIds] = await Promise.all([
      ids('tasks'), ids('journal_prompts'), ids('messages'),
      ((await admin.from('events').select('id').eq('group_id', gid)).data || []).map((r: any) => r.id as string),
    ])
    if (taskIds.length) await step('reading ticks', () => admin.from('task_completions').delete().in('task_id', taskIds))
    if (promptIds.length) await step('prompt answers', () => admin.from('journal_responses').delete().in('prompt_id', promptIds))
    if (messageIds.length) await step('chat reactions', () => admin.from('message_reactions').delete().eq('chat', 'table').in('message_id', messageIds))
    if (eventIds.length) await step('event sign-ups', () => admin.from('event_rsvps').delete().in('event_id', eventIds))
    await step('reading', () => admin.from('tasks').delete().eq('group_id', gid))
    await step('prompts', () => admin.from('journal_prompts').delete().eq('group_id', gid))
    await step('chat', () => admin.from('messages').delete().eq('group_id', gid))
    await step('library', () => admin.from('content').delete().eq('group_id', gid))
    await step('table-only events', () => admin.from('events').delete().eq('group_id', gid))
    await step('rooms', () => admin.from('rooms').update({ group_id: null }).eq('group_id', gid))
    await step('meeting outlines', () => admin.from('meeting_plans').delete().eq('group_id', gid))
    await step('attendance', () => admin.from('meeting_attendance').delete().eq('group_id', gid))
    await step('follow-ups', () => admin.from('table_posts').delete().eq('group_id', gid))
    await step('settings', () => admin.from('group_notification_settings').delete().eq('group_id', gid))
    await step('invite link', () => admin.from('group_invites').delete().eq('group_id', gid))
    await step('TCs', () => admin.from('group_leaders').delete().eq('group_id', gid))
    await step('seated people', () => admin.from('profiles').update({ group_id: null }).eq('group_id', gid))
    await step('table', () => admin.from('groups').delete().eq('id', gid))
  } catch (err: any) {
    console.error('delete table failed:', err?.message)
    return NextResponse.json({ error: `Could not delete the table (${err?.message || 'unknown error'}). Nothing after that step was removed.` }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
