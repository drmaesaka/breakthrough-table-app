'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { REACTION_EMOJIS, type ReactionChat, type ReactionSummary } from '@/lib/reactions'

/**
 * The message menu for all four chats (2026-10-09): hold a message, like on
 * an iPhone, for reactions (❤️ 👍 😂 😮 😢 🙏), Copy, and — on your own
 * messages — Edit, for typos. A right-click opens it on a computer.
 *
 * Stored server-side via /api/reactions, which checks the person can see the
 * message (and wrote it, to edit). Refreshed every 5 seconds for the newest
 * 100 messages on screen; that refresh also carries edited text, since the
 * chats themselves only poll for new messages.
 */
const HOLD_MS = 450

type Edit = { content: string | null; edited_at: string }

export function useReactions(chat: ReactionChat, messageIds: string[]) {
  const [map, setMap] = useState<Record<string, ReactionSummary[]>>({})
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  // When a hold last opened a menu: the tap the finger's release can produce
  // must not open a photo or close the menu it just opened.
  const heldAt = useRef(0)
  // Real rows only (a message still sending has no uuid yet), newest 100.
  const idsKey = messageIds.filter(id => /^[0-9a-f-]{36}$/i.test(String(id))).slice(-100).join(',')

  const call = useCallback(async (body: object) => {
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ chat, ...body }),
    }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    return { ok: Boolean(res?.ok), json }
  }, [chat])

  useEffect(() => {
    let alive = true
    async function refresh() {
      const ids = idsKey ? idsKey.split(',') : []
      if (!ids.length) return
      const { ok, json } = await call({ ids })
      if (!ok || !alive) return
      setMap(json.reactions || {})
      if (json.edits) setEdits(e => ({ ...e, ...json.edits }))
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
    const { ok, json } = await call({ id, emoji, toggle: true })
    if (ok) setMap(m => ({ ...m, [id]: json.reactions?.[id] || [] }))
  }

  async function saveEdit() {
    if (!editing) return
    const text = editing.text.trim()
    if (!text) { setEditError('A message cannot be empty'); return }
    setEditBusy(true); setEditError('')
    const { ok, json } = await call({ id: editing.id, content: text, edit: true })
    setEditBusy(false)
    if (!ok) { setEditError(json.error || 'Could not save. Try again.'); return }
    setEdits(e => ({ ...e, ...json.edits }))
    setEditing(null)
  }

  /** The text to show: the edited version if there is one. */
  function text(msg: { id: string; content?: string | null }) {
    return edits[msg.id]?.content ?? msg.content
  }

  /** Spread on a message: hold (or right-click) opens its menu. */
  function holdProps(id: string) {
    const cancel = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null } }
    return {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0]
        cancel()
        hold.current = { x: t.clientX, y: t.clientY, timer: setTimeout(() => {
          hold.current = null
          heldAt.current = Date.now()
          try { navigator.vibrate?.(10) } catch { /* not on iPhone */ }
          setOpenId(id)
        }, HOLD_MS) }
      },
      onTouchMove: (e: React.TouchEvent) => {
        // Scrolling, not holding.
        const t = e.touches[0]
        if (hold.current && Math.hypot(t.clientX - hold.current.x, t.clientY - hold.current.y) > 10) cancel()
      },
      onTouchEnd: cancel,
      onTouchCancel: cancel,
      onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); heldAt.current = Date.now(); setOpenId(id) },
      onClickCapture: (e: React.MouseEvent) => { if (Date.now() - heldAt.current < 700) { e.preventDefault(); e.stopPropagation() } },
      // No iOS text highlight / link preview fighting the hold (globals.css).
      className: 'chat-hold',
    }
  }

  /** Close the menu, unless it was opened a moment ago by the same press. */
  function closeMenu() {
    if (Date.now() - heldAt.current > 700) setOpenId(null)
  }

  return { map, edits, openId, setOpenId, closeMenu, toggle, text, holdProps, editing, setEditing, saveEdit, editBusy, editError, setEditError }
}

export type ReactionsState = ReturnType<typeof useReactions>

/** Under one message: its menu (when held), editor, reaction chips and "Edited". */
export function MessageReactions({ id, state, isMe, content }: {
  id: string
  state: ReactionsState
  isMe: boolean
  /** The message's text as shown; empty for a photo-only message. */
  content?: string | null
}) {
  const list = state.map[id] || []
  const open = state.openId === id
  const editing = state.editing?.id === id ? state.editing : null
  const edited = Boolean(state.edits[id]?.edited_at)
  const [copied, setCopied] = useState(false)
  if (!open && !editing && list.length === 0 && !edited) return null

  const action = 'px-3 py-2 text-sm font-medium text-bt-navy active:bg-bt-pale rounded-lg text-left'
  return (
    <div className={`flex flex-col gap-1 mt-1 ${isMe ? 'items-end' : 'items-start'}`}>
      {open && (
        <>
          {/* Tap anywhere else to close. */}
          <div className="fixed inset-0 z-40" onClick={state.closeMenu} />
          <div className="relative z-50 flex flex-col gap-1.5">
            <div className="flex gap-1 bg-white rounded-full shadow-lg border border-gray-100 px-2 py-1">
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
            {content && (
              <div className={`flex flex-col bg-white rounded-xl shadow-lg border border-gray-100 p-1 w-40 ${isMe ? 'self-end' : 'self-start'}`}>
                {isMe && (
                  <button type="button" className={action}
                    onClick={() => { state.setOpenId(null); state.setEditError(''); state.setEditing({ id, text: content }) }}>
                    ✏️ Edit
                  </button>
                )}
                <button type="button" className={action}
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* no clipboard */ }
                    setTimeout(() => state.setOpenId(null), 400)
                  }}>
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
            )}
            {list.length > 0 && (
              <p className="text-[11px] text-gray-500 bg-white/90 rounded-lg px-2 py-1">{list.map(r => `${r.emoji} ${r.names.join(', ')}`).join(' · ')}</p>
            )}
          </div>
        </>
      )}
      {editing && (
        <div className="w-64 max-w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-2 space-y-2">
          <textarea value={editing.text} autoFocus rows={3}
            onChange={e => state.setEditing({ id, text: e.target.value })}
            style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
            className="w-full bg-bt-pale rounded-xl px-3 py-2 text-base text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-bt-blue" />
          {state.editError && <p className="text-xs text-red-600">{state.editError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => state.setEditing(null)}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-500 text-xs font-semibold">Cancel</button>
            <button type="button" onClick={state.saveEdit} disabled={state.editBusy || !editing.text.trim()}
              className="flex-1 py-2 rounded-lg bg-bt-navy text-white text-xs font-semibold disabled:opacity-40">
              {state.editBusy ? 'Saving...' : 'Save'}
            </button>
          </div>
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
      {edited && !editing && <span className="text-[10px] text-gray-400 px-1">Edited</span>}
    </div>
  )
}
