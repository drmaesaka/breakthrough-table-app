// Habit streaks and adherence, in one place so the tasks screen and the nudge
// job cannot drift apart on what "done" means.
//
// A member may run several habits at once, each with its own streak. Mo's rule,
// 2026-08-24: they are tracked separately and one lapsing does not reset the
// others — so a streak is always computed per habit, never across them.

import { localDay } from './dates'

export type Habit = {
  id: string
  user_id: string
  name: string
  created_at: string
  archived_at: string | null
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
export function streakFor(dates: Set<string>, doneToday: boolean, now: Date = new Date()): number {
  const d = new Date(now)
  if (!doneToday) d.setDate(d.getDate() - 1)
  let streak = 0
  while (dates.has(localDay(d))) {
    streak++
    d.setDate(d.getDate() - 1)
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
