export type MeetingPlan = {
  number: number
  title: string
  resources: string[]
  foundations: string[]
  curriculum: string[]
  challenges: string[]
}

/** A plan as stored: same shape plus where it came from. */
export type StoredMeetingPlan = MeetingPlan & {
  id: string
  group_id: string | null
  updated_at?: string
}

export const MEETING_SECTIONS = [
  { key: 'resources', label: 'Resources & Handouts', icon: '📎' },
  { key: 'foundations', label: 'Recap & BT Foundations', icon: '🔁' },
  { key: 'curriculum', label: 'Curriculum', icon: '📋' },
  { key: 'challenges', label: 'Challenges', icon: '🎯' },
] as const

/**
 * Collapses defaults and one table's overrides into the plan list that table
 * actually runs: an override replaces the default for that meeting number
 * outright rather than merging section by section. Merging would let a TC who
 * cleared a section see it quietly reappear from the default underneath.
 */
export function resolveMeetingPlans(rows: StoredMeetingPlan[]): StoredMeetingPlan[] {
  const byNumber = new Map<number, StoredMeetingPlan>()
  for (const row of rows) {
    const existing = byNumber.get(row.number)
    // An override (group_id set) always wins over the default it shadows.
    if (!existing || (existing.group_id === null && row.group_id !== null)) {
      byNumber.set(row.number, row)
    }
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number)
}

// The curriculum itself lives in lib/meeting-plans-seed.ts, imported only by
// the server (the seed route). It must never be imported by a page: anything a
// page imports is shipped to every phone, and the outlines are TC-only.
