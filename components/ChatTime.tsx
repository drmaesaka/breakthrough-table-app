'use client'

/**
 * When chat messages were sent (2026-10-19), in all four chats, the way a
 * phone's messages app does it: a divider where the day changes, and a small
 * time under the last message of a run from one person (a run breaks after
 * 5 minutes).
 */

type Msg = { created_at?: string | null }

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString()
}

export function ChatDay({ msg, prev }: { msg: Msg; prev?: Msg }) {
  if (!msg.created_at) return null
  const d = new Date(msg.created_at)
  if (prev?.created_at && sameDay(d, new Date(prev.created_at))) return null
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const label = sameDay(d, today) ? 'Today'
    : sameDay(d, yesterday) ? 'Yesterday'
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
  return <p className="text-center text-[11px] font-semibold text-gray-400 pt-2 pb-1">{label}</p>
}

export function ChatTime({ msg, next, sameSender, isMe }: { msg: Msg; next?: Msg; sameSender: boolean; isMe: boolean }) {
  if (!msg.created_at) return null
  const t = new Date(msg.created_at)
  const continues = next?.created_at && sameSender
    && new Date(next.created_at).getTime() - t.getTime() < 5 * 60 * 1000
    && sameDay(t, new Date(next.created_at))
  if (continues) return null
  return (
    <span className={`text-[10px] text-gray-400 mt-0.5 px-1 ${isMe ? 'self-end' : 'self-start'}`}>
      {t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
    </span>
  )
}
