// Shared by /api/reactions and components/Reactions.tsx (2026-10-09).
export type ReactionChat = 'table' | 'room' | 'direct' | 'leaders'
  // Posts (2026-10-09): Reading & Resources, events, announcements.
  | 'task' | 'event' | 'announcement'
  // A table's Follow-ups feed (2026-10-09).
  | 'followup'
export const REACTION_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏']
export type ReactionSummary = { emoji: string; count: number; mine: boolean; names: string[] }
