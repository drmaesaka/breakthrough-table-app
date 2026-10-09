import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership } from '@/lib/api-auth'
import { doneInPeriod, streakFor, freqOf, type Frequency } from '@/lib/habits'
import { localDay } from '@/lib/dates'

// Everything a TC wants to know about each member of one table, in one
// call, for the My Table screen. Service key, table ownership checked.

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const groupId = req.nextUrl.searchParams.get('group_id') || ''
  if (!groupId) return NextResponse.json({ error: 'group_id is required' }, { status: 400 })
  const own = await requireGroupOwnership(auth.userId, groupId)
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

  const admin = adminClient()
  const today = localDay()
  const since = localDay(new Date(Date.now() - 35 * 86400000))

  const { data: members } = await admin
    .from('profiles')
    .select('id, full_name, avatar_url, role, adherence_percent, streak, contact_email, created_at')
    .eq('group_id', groupId)
  const ids = (members || []).map(m => m.id)
  if (!ids.length) return NextResponse.json({ members: [], tasks_total: 0 })

  const [{ data: habits }, { data: habitLog }, { data: tasks }, { data: taskDone }, { data: attendance }, { data: subs }, { data: prompts }, { data: responses }] = await Promise.all([
    admin.from('habits').select('id, user_id, name, frequency, created_at').is('archived_at', null).in('user_id', ids),
    admin.from('habit_completions').select('user_id, habit_id, completed_date').gte('completed_date', since).in('user_id', ids),
    admin.from('tasks').select('id, title').eq('group_id', groupId).eq('archived', false),
    admin.from('task_completions').select('user_id, task_id').in('user_id', ids),
    admin.from('meeting_attendance').select('user_id, meeting_date, meeting_number').eq('group_id', groupId).in('user_id', ids),
    admin.from('push_subscriptions').select('user_id').in('user_id', ids),
    admin.from('journal_prompts').select('id').eq('group_id', groupId),
    admin.from('journal_responses').select('user_id, prompt_id').in('user_id', ids),
  ])

  const taskIds = new Set((tasks || []).map(t => t.id))
  const promptIds = new Set((prompts || []).map(p => p.id))
  const datesByHabit = new Map<string, Set<string>>()
  for (const c of habitLog || []) {
    if (!c.habit_id) continue
    const set = datesByHabit.get(c.habit_id) ?? new Set<string>()
    set.add(c.completed_date); datesByHabit.set(c.habit_id, set)
  }
  const withPush = new Set((subs || []).map(s => s.user_id))

  const out = (members || []).map(m => {
    const myHabits = (habits || []).filter(h => h.user_id === m.id).map(h => {
      const f: Frequency = freqOf(h)
      const dates = datesByHabit.get(h.id) ?? new Set<string>()
      const done = doneInPeriod(dates, f, today)
      const last = [...dates].sort().slice(-1)[0] || null
      return { id: h.id, name: h.name, frequency: f, done, streak: streakFor(dates, done, new Date(), f), last_check_in: last }
    })
    // Distinct items: duplicate completion rows once showed '4 of 2'.
    const tasksDone = new Set((taskDone || []).filter(t => t.user_id === m.id && taskIds.has(t.task_id)).map(t => t.task_id)).size
    const att = (attendance || []).filter(a => a.user_id === m.id)
    const lastMeeting = att.map(a => a.meeting_date).sort().slice(-1)[0] || null
    const answered = (responses || []).filter(r => r.user_id === m.id && promptIds.has(r.prompt_id)).length
    return {
      id: m.id, full_name: m.full_name, avatar_url: m.avatar_url, role: m.role,
      adherence_percent: m.adherence_percent || 0, streak: m.streak || 0,
      email: m.contact_email || null, joined: m.created_at,
      habits: myHabits,
      tasks_done: tasksDone,
      meetings_attended: att.length, last_meeting: lastMeeting,
      prompts_answered: answered,
      push_enabled: withPush.has(m.id),
    }
  }).sort((a, b) => (b.adherence_percent - a.adherence_percent) || a.full_name.localeCompare(b.full_name))

  return NextResponse.json({ members: out, tasks_total: taskIds.size, prompts_total: promptIds.size })
}
