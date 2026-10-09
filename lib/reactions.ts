// Shared by /api/reactions and components/Reactions.tsx (2026-10-09).
export type ReactionChat = 'table' | 'room' | 'direct' | 'leaders'
export const REACTION_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏']
export type ReactionSummary = { emoji: string; count: number; mine: boolean; names: string[] }
