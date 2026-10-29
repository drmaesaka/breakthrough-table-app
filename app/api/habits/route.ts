import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// Habits, habit check-offs and task check-offs for the caller (2026-10-29).
// Server-side because the browser's deletes (un-ticking) could be filtered to
// zero rows by a console policy and report success, and its ticks were never
// checked at all — a streak could look kept on the phone and not exist.
//
// POST { action: 'add', name, frequency }        → { habit }
// POST { action: 'check', habit_id, date }        (date = member's local day)
// POST { action: 'uncheck', habit_id, dates[] }
// POST { action: 'graduate', habit_id }
// POST { action: 'task', task_id, done }
// Any of the last four may carry `adherence` (0–100) to store on the profile.

const DAY = /^\d{4}-\d{2}-\d{2}$/
const FREQS = ['daily', 'weekly', 'monthly']

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const me = auth.userId
  const body = await req.json().catch(() => ({}))
  const admin = adminClient()

  async function ownHabit(id: unknown) {
    if (typeof id !== 'string') return null
    const { data } = await admin.from('habits').select('id, name, user_id').eq('id', id).maybeSingle()
    return data?.user_id === me ? data : null
  }

  let result: Record<string, unknown> = { ok: true }
  switch (body.action) {
    case 'add': {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return NextResponse.json({ error: 'Name the habit' }, { status: 400 })
      const frequency = FREQS.includes(body.frequency) ? body.frequency : 'daily'
      let { data, error } = await admin.from('habits').insert({ user_id: me, name, frequency }).select().single()
      // Before the 2026-09-29 migration the column does not exist: save as daily.
      if (error && /frequency/.test(error.message)) {
        ;({ data, error } = await admin.from('habits').insert({ user_id: me, name }).select().single())
      }
      if (error) return NextResponse.json({ error: 'Could not save the habit' }, { status: 500 })
      result = { habit: data }
      break
    }
    case 'check': {
      if (!(await ownHabit(body.habit_id))) return NextResponse.json({ error: 'Not your habit' }, { status: 403 })
      if (!DAY.test(body.date || '')) return NextResponse.json({ error: 'Bad date' }, { status: 400 })
      const { error } = await admin.from('habit_completions').insert({ user_id: me, habit_id: body.habit_id, completed_date: body.date })
      // Already ticked that day (a double tap) is fine.
      if (error && error.code !== '23505') return NextResponse.json({ error: 'Could not save the check-off' }, { status: 500 })
      break
    }
    case 'uncheck': {
      if (!(await ownHabit(body.habit_id))) return NextResponse.json({ error: 'Not your habit' }, { status: 403 })
      const dates = Array.isArray(body.dates) ? body.dates.filter((d: unknown) => typeof d === 'string' && DAY.test(d)) : []
      if (!dates.length) return NextResponse.json({ error: 'Bad dates' }, { status: 400 })
      const { error } = await admin.from('habit_completions').delete().eq('user_id', me).eq('habit_id', body.habit_id).in('completed_date', dates)
      if (error) return NextResponse.json({ error: 'Could not undo the check-off' }, { status: 500 })
      break
    }
    case 'graduate': {
      const habit = await ownHabit(body.habit_id)
      if (!habit) return NextResponse.json({ error: 'Not your habit' }, { status: 403 })
      // History first: archiving after a failed insert would lose the habit
      // with no record it ever existed.
      const { error: hErr } = await admin.from('habit_history').insert({ user_id: me, habit_name: habit.name, graduated_at: new Date().toISOString() })
      if (hErr) return NextResponse.json({ error: 'Could not save the badge' }, { status: 500 })
      const { error } = await admin.from('habits').update({ archived_at: new Date().toISOString() }).eq('id', habit.id)
      if (error) return NextResponse.json({ error: 'Could not retire the habit' }, { status: 500 })
      break
    }
    case 'task': {
      if (typeof body.task_id !== 'string') return NextResponse.json({ error: 'Bad task' }, { status: 400 })
      const { data: task } = await admin.from('tasks').select('id').eq('id', body.task_id).maybeSingle()
      if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      const { error } = body.done
        ? await admin.from('task_completions').insert({ task_id: task.id, user_id: me })
        : await admin.from('task_completions').delete().eq('task_id', task.id).eq('user_id', me)
      if (error && error.code !== '23505') return NextResponse.json({ error: 'Could not save' }, { status: 500 })
      break
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  if (typeof body.adherence === 'number' && body.adherence >= 0 && body.adherence <= 100) {
    const { error } = await admin.from('profiles').update({ adherence_percent: Math.round(body.adherence) }).eq('id', me)
    if (error) console.error('adherence save failed:', error.message)
  }
  return NextResponse.json(result)
}
