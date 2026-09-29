// Habit streaks and adherence, in one place so the tasks screen and the nudge
// job cannot drift apart on what "done" means.
//
// A member may run several habits at once, each with its own streak. Mo's rule,
// 2026-08-24: they are tracked separately and one lapsing does not reset the
// others — so a streak is always computed per habit, never across them.

import { localDay } from './dates'

export type Frequency = 'daily' | 'weekly' | 'monthly'

export type Habit = {
  id: string
  user_id: string
  name: string
  created_at: string
  archived_at: string | null
  /** Missing on rows read before the 2026-09-29 migration: treat as daily. */
  frequency?: Frequency | null
}

export function freqOf(h: { frequency?: string | null }): Frequency {
  return h.frequency === 'weekly' || h.frequency === 'monthly' ? h.frequency : 'daily'
}

export const FREQ_LABEL: Record<Frequency, { noun: string; period: string; checkIn: string }> = {
  daily:   { noun: 'day',   period: 'today',      checkIn: 'Daily check-in' },
  weekly:  { noun: 'week',  period: 'this week',  checkIn: 'Weekly check-in' },
  monthly: { noun: 'month', period: 'this month', checkIn: 'Monthly check-in' },
}

/**
 * The period a local day (YYYY-MM-DD) belongs to, as a key.
 * daily → the day; weekly → the Monday of that week; monthly → YYYY-MM.
 */
export function periodKey(day: string, freq: Frequency): string {
  if (freq === 'daily') return day
  const [y, m, d] = day.split('-').map(Number)
  if (freq === 'monthly') return `${y}-${String(m).padStart(2, '0')}`
  const date = new Date(y, m - 1, d)
  const dow = (date.getDay() + 6) % 7 // Monday = 0
  date.setDate(date.getDate() - dow)
  return localDay(date)
}

/** The period before `key`, as a key. */
export function previousPeriod(key: string, freq: Frequency): string {
  if (freq === 'monthly') {
    const [y, m] = key.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - (freq === 'weekly' ? 7 : 1))
  return localDay(date)
}

/** Whether any completion date falls in the period containing `day`. */
export function doneInPeriod(dates: Set<string>, freq: Frequency, day: string): boolean {
  const key = periodKey(day, freq)
  for (const d of dates) if (periodKey(d, freq) === key) return true
  return false
}

/**
 * Whether a nudge is warranted for an outstanding habit on `day`. Daily:
 * always. Weekly: Friday onwards. Monthly: the last five days. Earlier than
 * that, a reminder every day for a once-a-week habit is noise.
 */
export function nudgeDue(freq: Frequency, day: string): boolean {
  if (freq === 'daily') return true
  const [y, m, d] = day.split('-').map(Number)
  if (freq === 'weekly') return ((new Date(y, m - 1, d).getDay() + 6) % 7) >= 4
  const lastDay = new Date(y, m, 0).getDate()
  return lastDay - d < 5
}

export type HabitCompletion = {
  habit_id: string | null
  completed_date: string
}

/**
 * How many consecutive days this habit has been logged.
 *
 * When today is still outstanding, counts back from yesterday instead. A run in
 * progress should read as intact-and-at-risk rather than collapsing to zero
 * every morning before the member has had a chance to tap in.
 */
export function streakFor(dates: Set<string>, doneToday: boolean, now: Date = new Date(), freq: Frequency = 'daily'): number {
  // Consecutive periods with at least one check-in, counting back from the
  // current period (or the previous one while the current is outstanding).
  const periods = new Set<string>()
  for (const d of dates) periods.add(periodKey(d, freq))
  let key = periodKey(localDay(now), freq)
  if (!doneToday) key = previousPeriod(key, freq)
  let streak = 0
  while (periods.has(key)) {
    streak++
    key = previousPeriod(key, freq)
  }
  return streak
}

/** Completion dates per habit, for streak maths. */
export function datesByHabit(completions: HabitCompletion[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const c of completions) {
    if (!c.habit_id) continue
    const set = out.get(c.habit_id) ?? new Set<string>()
    set.add(c.completed_date)
    out.set(c.habit_id, set)
  }
  return out
}

/**
 * Adherence for the period.
 *
 * Each habit counts as one item, exactly like a reading task. With a single
 * habit this is arithmetically identical to the old `totalTasks + 1`, so nobody's
 * number moved when multiple habits shipped — which is the only reason this
 * could be decided without a product call.
 *
 * A member with no habits at all is scored on their tasks alone rather than
 * being punished for a denominator they cannot affect.
 */
export function calcAdherence(
  completedTasks: number,
  habitsDoneToday: number,
  totalTasks: number,
  habitCount: number
): number {
  const total = totalTasks + habitCount
  if (total <= 0) return 0
  const done = completedTasks + habitsDoneToday
  return Math.round((done / total) * 100)
}
