'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { REACTION_EMOJIS, type ReactionChat, type ReactionSummary } from '@/lib/reactions'

/**
 * Reactions (❤️ 👍 😂 😮 😢 🙏) on chat messages, for all four chats
 * (2026-10-09). Tap a message to open the picker; tap an emoji to add or
 * take back yours. Stored server-side via /api/reactions, which checks the
 * person can see the message. Refreshed every 5 seconds alongside the chat's
 * own polling, for the newest 100 messages on screen.
 */
export function useReactions(chat: ReactionChat, messageIds: string[]) {
  const [map, setMap] = useState<Record<string, ReactionSummary[]>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  // Real rows only (a message still sending has no uuid yet), newest 100.
  const idsKey = messageIds.filter(id => /^[0-9a-f-]{36}$/i.test(String(id))).slice(-100).join(',')

  const call = useCallback(async (body: object) => {
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ chat, ...body }),
    }).catch(() => null)
    return res?.ok ? ((await res.json()).reactions || {}) as Record<string, ReactionSummary[]> : null
  }, [chat])

  useEffect(() => {
    let alive = true
    async function refresh() {
      const ids = idsKey ? idsKey.split(',') : []
      if (!ids.length) return
      const r = await call({ ids })
      if (r && alive) setMap(r)
    }
    refresh()
    const t = setInterval(refresh, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [idsKey, call])

  async function toggle(id: string, emoji: string) {
    setOpenId(null)
    // Show it at once; the server's answer replaces it.
    setMap(m => {
      const list = (m[id] || []).map(x => ({ ...x, names: [...x.names] }))
      const e = list.find(x => x.emoji === emoji)
      if (e?.mine) { e.mine = false; e.count--; e.names = e.names.filter(n => n !== 'You') }
      else if (e) { e.mine = true; e.count++; e.names.push('You') }
      else list.push({ emoji, count: 1, mine: true, names: ['You'] })
      return { ...m, [id]: list.filter(x => x.count > 0) }
    })
    const r = await call({ id, emoji, toggle: true })
    if (r) setMap(m => ({ ...m, [id]: r[id] || [] }))
  }

  /** Tap on a message opens its picker (taps on its photo or a chip do their own thing). */
  function tapMessage(e: React.MouseEvent, id: string) {
    if ((e.target as HTMLElement).closest('a, button')) return
    setOpenId(o => o === id ? null : id)
  }

  return { map, openId, setOpenId, toggle, tapMessage }
}

export type ReactionsState = ReturnType<typeof useReactions>

/** The picker (when open) and the reaction chips, under one message. */
export function MessageReactions({ id, state, isMe }: { id: string; state: ReactionsState; isMe: boolean }) {
  const list = state.map[id] || []
  const open = state.openId === id
  if (!open && list.length === 0) return null
  return (
    <div className={`flex flex-col gap-1 mt-1 ${isMe ? 'items-end' : 'items-start'}`}>
      {open && (
        <div className="flex gap-1 bg-white rounded-full shadow-md border border-gray-100 px-2 py-1">
          {REACTION_EMOJIS.map(e => {
            const mine = list.some(x => x.emoji === e && x.mine)
            return (
              <button key={e} type="button" onClick={() => state.toggle(id, e)} aria-label={`React ${e}`}
                className={`text-xl w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform ${mine ? 'bg-bt-pale' : ''}`}>
                {e}
              </button>
            )
          })}
        </div>
      )}
      {list.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {list.map(r => (
            <button key={r.emoji} type="button" onClick={() => state.toggle(id, r.emoji)}
              className={`text-xs px-2 py-0.5 rounded-full border ${r.mine ? 'bg-bt-pale border-bt-blue/40 text-bt-navy' : 'bg-white border-gray-200 text-gray-600'}`}>
              {r.emoji}{r.count > 1 ? ` ${r.count}` : ''}
            </button>
          ))}
        </div>
      )}
      {open && list.length > 0 && (
        <p className="text-[11px] text-gray-400 px-1">{list.map(r => `${r.emoji} ${r.names.join(', ')}`).join(' · ')}</p>
      )}
    </div>
  )
}
