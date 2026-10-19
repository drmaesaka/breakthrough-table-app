'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase'

// @mentions (2026-10-19). A tag is plain text — "@Full Name" — so copying,
// editing and old messages all just work; who was tagged is worked out from
// the names of the people in that chat. /api/mentions lists them and pings
// whoever was tagged.

export type MentionChat = 'table' | 'room' | 'direct' | 'leaders' | 'followup' | 'followup_reply'
export type MentionPerson = { id: string; full_name: string; avatar_url: string | null }

async function authHeaders() {
  const { data: { session } } = await createClient().auth.getSession()
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` }
}

/** Who can be tagged in this chat (not you). `id`: group, room or conversation id. */
export function useMentionPeople(chat: MentionChat, id: string | null | undefined): MentionPerson[] {
  const [people, setPeople] = useState<MentionPerson[]>([])
  useEffect(() => {
    if (chat !== 'leaders' && !id) return
    let alive = true
    ;(async () => {
      const res = await fetch(`/api/mentions?chat=${chat}&id=${encodeURIComponent(id || '')}`, { headers: await authHeaders() }).catch(() => null)
      const json = res?.ok ? await res.json().catch(() => ({})) : {}
      if (alive) setPeople(json.people || [])
    })()
    return () => { alive = false }
  }, [chat, id])
  return people
}

/** The people tagged in `text`. Longest names first, so "@Jo Ann" beats "@Jo". */
export function mentionedIn(text: string, people: MentionPerson[]): MentionPerson[] {
  const t = text.toLowerCase()
  return people.filter(p => p.full_name && t.includes('@' + p.full_name.toLowerCase()))
}

/** Pings whoever `text` tags. Fire and forget, after the message is saved. */
export async function notifyMentions(chat: MentionChat, messageId: string | null | undefined, text: string, people: MentionPerson[]) {
  const ids = mentionedIn(text, people).map(p => p.id)
  if (!messageId || !ids.length) return
  try {
    await fetch('/api/mentions', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ chat, message_id: messageId, user_ids: ids }) })
  } catch { /* the message itself is sent; a missed ping is not worth an error */ }
}

/**
 * `text` with each "@Full Name" of someone in the chat drawn bold.
 * `wrap` renders the plain stretches (e.g. linkify in Follow-ups).
 */
export function withMentions(text: string | null | undefined, people: MentionPerson[], className: string, wrap: (s: string) => ReactNode = s => s): ReactNode {
  if (!text) return text
  const names = people.map(p => p.full_name).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!names.length || !text.includes('@')) return wrap(text)
  const esc = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`@(${esc.join('|')})`, 'gi')
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(<span key={`t${last}`}>{wrap(text.slice(last, m.index))}</span>)
    out.push(<span key={`m${m.index}`} className={className}>{m[0]}</span>)
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(<span key={`t${last}`}>{wrap(text.slice(last))}</span>)
  return out
}
