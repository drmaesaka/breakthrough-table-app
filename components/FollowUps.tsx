'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { linkify } from '@/lib/linkify'
import Avatar from '@/components/Avatar'
import { usePhotoAttach, PhotoButton, PhotoPreview, MessagePhoto } from '@/components/ChatPhoto'
import { useReactions, PostReactions } from '@/components/Reactions'

/**
 * My Table → Follow-ups (2026-10-09): the table's meeting follow-ups, apart
 * from the chat. TCs post (text, a link or a Library item, a photo); everyone
 * at the table reacts and replies under each one. Content posted to the
 * table's Sunrise group shows up here by itself. All through /api/followups.
 */

type Person = { full_name: string; avatar_url: string | null } | null
type Reply = { id: string; body: string; image_url: string | null; created_at: string; edited_at: string | null; author: Person; mine: boolean }
type Post = {
  id: string; source: 'app' | 'sunrise'; title: string | null; body: string; link_url: string | null; image_url: string | null
  sunrise_author: string | null; created_at: string; edited_at: string | null; author: Person; mine: boolean; replies: Reply[]
}

function when(iso: string) {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days < 1 && new Date().toDateString() === d.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) })
}

export default function FollowUps({ groupId, groupName, userId }: { groupId: string; groupName: string; userId: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [canPost, setCanPost] = useState(false)
  const [library, setLibrary] = useState<{ id: string; title: string; url: string }[]>([])
  const [note, setNote] = useState('')
  const rx = useReactions('followup', (posts || []).map(p => p.id))

  // Composer (TCs)
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  const att = usePhotoAttach(userId)

  // Threads, replies, edits
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [replyText, setReplyText] = useState<Record<string, string>>({})
  const [replying, setReplying] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ kind: 'post' | 'reply'; id: string; text: string } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const call = useCallback(async (init?: { method: 'POST'; body: object }) => {
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch(init ? '/api/followups' : `/api/followups?group_id=${encodeURIComponent(groupId)}`, {
      method: init ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    return { ok: Boolean(res?.ok), json }
  }, [groupId])

  const load = useCallback(async () => {
    const { ok, json } = await call()
    if (!ok) { setNote(json.error || 'Could not load follow-ups'); setPosts(p => p || []); return }
    setNote(json.note === 'not set up' ? 'Follow-ups are almost ready: one setup step is left.' : '')
    setPosts(json.posts || []); setCanPost(Boolean(json.canPost)); setLibrary(json.library || [])
  }, [call])

  useEffect(() => {
    setPosts(null); setComposing(false); setOpenThread(null); setEditing(null)
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  async function post() {
    if (!body.trim() && !title.trim()) return
    setPosting(true); setPostError('')
    const { ok, json } = await call({ method: 'POST', body: { action: 'post', group_id: groupId, title, body, link_url: link, image_url: att.photo } })
    setPosting(false)
    if (!ok) { setPostError(json.error || 'Could not post. Try again.'); return }
    setTitle(''); setBody(''); setLink(''); att.clear(); setComposing(false)
    load()
  }

  async function reply(postId: string) {
    const text = (replyText[postId] || '').trim()
    if (!text) return
    setReplying(postId)
    const { ok, json } = await call({ method: 'POST', body: { action: 'reply', post_id: postId, body: text } })
    setReplying(null)
    if (!ok) { alert(json.error || 'Could not send. Try again.'); return }
    setReplyText(r => ({ ...r, [postId]: '' }))
    load()
  }

  async function saveEdit() {
    if (!editing?.text.trim()) return
    const { ok, json } = await call({ method: 'POST', body: { action: 'edit', kind: editing.kind, id: editing.id, body: editing.text } })
    if (!ok) { alert(json.error || 'Could not save.'); return }
    setEditing(null); load()
  }

  async function remove(kind: 'post' | 'reply', id: string) {
    if (!confirm(kind === 'post' ? 'Remove this follow-up for everyone at the table?' : 'Remove this reply?')) return
    const { ok, json } = await call({ method: 'POST', body: { action: 'delete', kind, id } })
    if (!ok) { alert(json.error || 'Could not remove.'); return }
    load()
  }

  const input = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue'

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 pb-28 space-y-3">
      {canPost && (
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          {!composing ? (
            <button type="button" onClick={() => setComposing(true)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-bt-navy">
              📝 Post a follow-up to {groupName}
            </button>
          ) : (
            <>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional), e.g. Meeting 4 follow-up" className={input} />
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
                placeholder="What we covered, what to read or do before next time..." className={`${input} resize-none leading-relaxed`} />
              <input value={link} onChange={e => setLink(e.target.value)} placeholder="Link (optional)" className={input} />
              {library.length > 0 && (
                <select value="" onChange={e => {
                  const item = library.find(l => l.id === e.target.value)
                  if (item) { setLink(item.url); if (!title.trim()) setTitle(item.title) }
                }} className={`${input} bg-white`}>
                  <option value="">📖 Or attach something from the Library...</option>
                  {library.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              )}
              <div className="flex items-center gap-2">
                <PhotoButton att={att} />
                <span className="text-xs text-gray-400">Add a photo (optional)</span>
              </div>
              <PhotoPreview att={att} />
              {postError && <p className="text-xs text-red-600">{postError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setComposing(false); setPostError('') }}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold">Cancel</button>
                <button type="button" onClick={post} disabled={posting || att.busy || (!body.trim() && !title.trim())}
                  className="flex-[2] bg-bt-navy text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40">
                  {posting ? 'Posting...' : 'Post to the table'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">Everyone at {groupName} gets a notification.</p>
            </>
          )}
        </div>
      )}

      {note && <p className="text-xs text-gray-500 px-1">{note}</p>}
      {posts === null && <p className="text-center text-gray-400 text-sm py-8">Loading...</p>}
      {posts?.length === 0 && !note && (
        <div className="text-center py-14">
          <p className="text-4xl mb-3">📝</p>
          <p className="text-gray-500 font-medium">No follow-ups yet</p>
          <p className="text-gray-400 text-sm mt-1">After each meeting your TC posts what you covered and what&apos;s next.</p>
        </div>
      )}

      {posts?.map(p => {
        const name = p.source === 'sunrise' ? (p.sunrise_author || 'Sunrise Network') : p.author?.full_name || 'TC'
        const long = p.body.length > 420 && !expanded.has(p.id)
        const threadOpen = openThread === p.id
        const isEditing = editing?.kind === 'post' && editing.id === p.id
        return (
          <div key={p.id} className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2.5">
              <Avatar src={p.author?.avatar_url} name={name} className="w-8 h-8 bg-bt-pale" textClass="text-bt-navy font-bold text-xs" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
                <p className="text-[11px] text-gray-400">
                  {when(p.created_at)}{p.edited_at ? ' · edited' : ''}{p.source === 'sunrise' ? ' · 🌅 from Sunrise' : ''}
                </p>
              </div>
              {(p.mine || canPost) && !isEditing && (
                <div className="flex gap-2 text-[11px] font-semibold flex-shrink-0">
                  {p.mine && <button type="button" onClick={() => setEditing({ kind: 'post', id: p.id, text: p.body })} className="text-bt-blue">Edit</button>}
                  <button type="button" onClick={() => remove('post', p.id)} className="text-red-400">Remove</button>
                </div>
              )}
            </div>

            {p.title && <p className="font-bold text-bt-navy mt-3 leading-snug">{p.title}</p>}
            {isEditing ? (
              <div className="mt-2 space-y-2">
                <textarea value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} rows={5} className={`${input} resize-none`} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditing(null)} className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-500 text-xs font-semibold">Cancel</button>
                  <button type="button" onClick={saveEdit} className="flex-1 py-2 rounded-lg bg-bt-navy text-white text-xs font-semibold">Save</button>
                </div>
              </div>
            ) : p.body && (
              <>
                <p className="text-sm text-gray-700 mt-1.5 leading-relaxed whitespace-pre-wrap break-words">
                  {linkify(long ? p.body.slice(0, 400) + '…' : p.body)}
                </p>
                {p.body.length > 420 && (
                  <button type="button" onClick={() => setExpanded(s => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                    className="text-bt-blue text-xs font-semibold mt-1">{long ? 'More' : 'Less'}</button>
                )}
              </>
            )}
            {p.image_url && <div className="mt-2"><MessagePhoto url={p.image_url} /></div>}
            {p.link_url && (
              <a href={p.link_url} target="_blank" rel="noopener noreferrer"
                className="mt-3 block text-center py-2 rounded-xl bg-bt-pale text-bt-navy text-sm font-semibold">
                {p.source === 'sunrise' ? 'Open it →' : 'Open link →'}
              </a>
            )}

            <div className="flex items-start justify-between gap-2">
              <PostReactions id={p.id} state={rx} />
              <button type="button" onClick={() => setOpenThread(threadOpen ? null : p.id)}
                className="mt-2 text-xs font-semibold text-bt-blue flex-shrink-0 py-0.5">
                💬 {p.replies.length ? `${p.replies.length} repl${p.replies.length === 1 ? 'y' : 'ies'}` : 'Reply'}
              </button>
            </div>

            {threadOpen && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                {p.replies.map(r => {
                  const rName = r.author?.full_name || 'Member'
                  const rEditing = editing?.kind === 'reply' && editing.id === r.id
                  return (
                    <div key={r.id} className="flex gap-2">
                      <Avatar src={r.author?.avatar_url} name={rName} className="w-7 h-7 bg-bt-pale flex-shrink-0" textClass="text-bt-navy font-bold text-[10px]" />
                      <div className="min-w-0 flex-1 bg-bt-pale rounded-xl px-3 py-2">
                        <p className="text-xs font-semibold text-gray-900">{rName} <span className="font-normal text-gray-400">· {when(r.created_at)}{r.edited_at ? ' · edited' : ''}</span></p>
                        {rEditing ? (
                          <div className="mt-1 space-y-1.5">
                            <textarea value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} rows={3} className={`${input} resize-none text-sm`} />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-500 font-semibold">Cancel</button>
                              <button type="button" onClick={saveEdit} className="text-xs text-bt-blue font-semibold">Save</button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{linkify(r.body)}</p>
                        )}
                        {r.image_url && <MessagePhoto url={r.image_url} />}
                        {(r.mine || canPost) && !rEditing && (
                          <div className="flex gap-3 mt-1 text-[11px] font-semibold">
                            {r.mine && <button type="button" onClick={() => setEditing({ kind: 'reply', id: r.id, text: r.body })} className="text-bt-blue">Edit</button>}
                            <button type="button" onClick={() => remove('reply', r.id)} className="text-red-400">Remove</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div className="flex items-end gap-2">
                  <textarea value={replyText[p.id] || ''} rows={1}
                    onChange={e => { setReplyText(r => ({ ...r, [p.id]: e.target.value })); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px` }}
                    placeholder="Write a reply..."
                    className="flex-1 min-w-0 bg-bt-pale rounded-2xl px-4 py-2.5 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-bt-blue" />
                  <button type="button" onClick={() => reply(p.id)} disabled={replying === p.id || !(replyText[p.id] || '').trim()}
                    className="h-10 px-4 rounded-full bg-bt-navy text-white text-xs font-semibold disabled:opacity-40 flex-shrink-0">
                    {replying === p.id ? '...' : 'Reply'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
