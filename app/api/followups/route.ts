import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser, leaderGroupIds } from '@/lib/api-auth'
import { causeMachineConfigured } from '@/lib/cause-machine'
import { sunriseGroupPosts } from '@/lib/sunrise-library'
import { isOwnChatPhoto } from '@/lib/chat-photo'
import { notifyMembers } from '@/lib/notify'

// A table's Follow-ups feed (2026-10-09; sql/2026-10-09-follow-ups.sql).
// TCs post meeting follow-ups; everyone at the table reacts and replies under
// them, apart from the chat. Content posted to the table's Sunrise group is
// copied in as follow-ups too, so a TC who posts on Sunrise posts once.
//
// GET  ?group_id=                                 → { posts, canPost, library }
// POST { action: 'post', group_id, body, title?, link_url?, image_url? }   TCs of the table
// POST { action: 'reply', post_id, body, image_url? }                       anyone at the table
// POST { action: 'edit', kind: 'post'|'reply', id, body }                   the author
// POST { action: 'delete', kind: 'post'|'reply', id }                       the author, or a TC of the table

async function access(userId: string, role: string, groupId: string) {
  const [{ data: prof }, led] = await Promise.all([
    adminClient().from('profiles').select('group_id').eq('id', userId).maybeSingle(),
    role === 'leader' ? leaderGroupIds(userId) : Promise.resolve([] as string[]),
  ])
  const isTC = led.includes(groupId)
  return { canSee: isTC || prof?.group_id === groupId, isTC }
}

// Sunrise group posts → table_posts, at most every five minutes per table.
const lastSync = new Map<string, number>()
async function syncSunrise(groupId: string) {
  if (!causeMachineConfigured() || Date.now() - (lastSync.get(groupId) || 0) < 5 * 60 * 1000) return
  lastSync.set(groupId, Date.now())
  const admin = adminClient()
  const { data: g } = await admin.from('groups').select('sunrise_group_id').eq('id', groupId).maybeSingle()
  const sid = Number(g?.sunrise_group_id || 0)
  if (!sid) return
  try {
    const items = await sunriseGroupPosts(sid)
    if (!items.length) return
    const { error } = await admin.from('table_posts').upsert(items.map(i => ({
      group_id: groupId, source: 'sunrise', source_id: i.id, title: i.title,
      body: i.text.slice(0, 4000), link_url: i.url, sunrise_author: i.author,
      created_at: i.date || new Date().toISOString(),
    })), { onConflict: 'group_id,source,source_id', ignoreDuplicates: true })
    if (error) console.error('followups: sunrise sync failed:', error.message)
  } catch (err) {
    console.error('followups: sunrise read failed:', err)
  }
}

function people(rows: any[]) {
  return new Map<string, { full_name: string; avatar_url: string | null }>(
    rows.map(p => [p.id, { full_name: p.full_name || 'Member', avatar_url: p.avatar_url || null }]))
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const groupId = new URL(req.url).searchParams.get('group_id') || ''
  const { canSee, isTC } = await access(auth.userId, auth.role, groupId)
  if (!canSee) return NextResponse.json({ error: 'Not your table' }, { status: 403 })

  await syncSunrise(groupId)
  const admin = adminClient()
  const { data: posts, error } = await admin.from('table_posts').select('*')
    .eq('group_id', groupId).eq('hidden', false).order('created_at', { ascending: false }).limit(60)
  if (error) {
    if (/table_posts/.test(error.message)) return NextResponse.json({ posts: [], canPost: false, note: 'not set up' })
    return NextResponse.json({ error: 'Could not load follow-ups' }, { status: 500 })
  }
  const ids = (posts || []).map(p => p.id)
  const { data: replies } = ids.length
    ? await admin.from('table_post_replies').select('*').in('post_id', ids).order('created_at')
    : { data: [] as any[] }
  const authorIds = [...new Set([...(posts || []).map(p => p.author_id), ...(replies || []).map(r => r.author_id)].filter(Boolean))]
  const { data: profs } = authorIds.length
    ? await admin.from('profiles').select('id, full_name, avatar_url').in('id', authorIds)
    : { data: [] as any[] }
  const who = people(profs || [])

  // A TC's quick picks when posting: this table's own Library items.
  const { data: library } = isTC
    ? await admin.from('content').select('id, title, url, type').eq('group_id', groupId).order('created_at', { ascending: false }).limit(50)
    : { data: [] as any[] }

  return NextResponse.json({
    canPost: isTC,
    library: library || [],
    posts: (posts || []).map(p => ({
      ...p,
      author: p.author_id ? who.get(p.author_id) || null : null,
      mine: p.author_id === auth.userId,
      replies: (replies || []).filter(r => r.post_id === p.id).map(r => ({
        ...r, author: who.get(r.author_id) || null, mine: r.author_id === auth.userId,
      })),
    })),
  })
}

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const safeUrl = (v: unknown) => { const u = clean(v, 1000); return /^https?:\/\//i.test(u) ? u : null }

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const b = await req.json().catch(() => ({}))
  const admin = adminClient()
  const photo = (v: unknown) => (v && isOwnChatPhoto(v, auth.userId) ? v as string : null)

  if (b.action === 'post') {
    const groupId = clean(b.group_id, 64)
    const { isTC } = await access(auth.userId, auth.role, groupId)
    if (!isTC) return NextResponse.json({ error: 'Only the table’s TCs post follow-ups' }, { status: 403 })
    const body = clean(b.body, 4000)
    const title = clean(b.title, 200) || null
    if (!body && !title) return NextResponse.json({ error: 'Write something first' }, { status: 400 })
    const { data, error } = await admin.from('table_posts').insert({
      group_id: groupId, author_id: auth.userId, source: 'app', title, body,
      link_url: safeUrl(b.link_url), image_url: photo(b.image_url),
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Everyone at the table, apart from the TC posting.
    const { data: seated } = await admin.from('profiles').select('id').eq('group_id', groupId)
    await notifyMembers(admin, {
      kind: 'task', recipientIds: (seated || []).map(p => p.id).filter(id => id !== auth.userId),
      title: '📝 New follow-up from your TC', body: title || body, url: `/group?table=${groupId}&tab=followups`,
      emailFallback: true, emailCta: 'See it on My Table',
    }).catch(err => console.error('followups: notify failed:', err))
    return NextResponse.json({ id: data.id })
  }

  if (b.action === 'reply') {
    const { data: post } = await admin.from('table_posts').select('id, group_id, author_id, title, body').eq('id', clean(b.post_id, 64)).maybeSingle()
    if (!post) return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 })
    const { canSee } = await access(auth.userId, auth.role, post.group_id)
    if (!canSee) return NextResponse.json({ error: 'Not your table' }, { status: 403 })
    const body = clean(b.body, 4000)
    const image = photo(b.image_url)
    if (!body && !image) return NextResponse.json({ error: 'Write something first' }, { status: 400 })
    const { data, error } = await admin.from('table_post_replies').insert({ post_id: post.id, author_id: auth.userId, body, image_url: image }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Tell whoever posted it (a Sunrise copy has no app author).
    if (post.author_id && post.author_id !== auth.userId) {
      const { data: me } = await admin.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle()
      await notifyMembers(admin, {
        kind: 'chat', recipientIds: [post.author_id],
        title: `💬 ${me?.full_name || 'Someone'} replied to your follow-up`, body: body || 'Sent a photo',
        url: `/group?table=${post.group_id}&tab=followups`, emailFallback: false,
      }).catch(err => console.error('followups: reply notify failed:', err))
    }
    return NextResponse.json({ id: data.id })
  }

  if (b.action === 'edit' || b.action === 'delete') {
    const table = b.kind === 'reply' ? 'table_post_replies' : 'table_posts'
    const { data: row } = await admin.from(table).select('*').eq('id', clean(b.id, 64)).maybeSingle()
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const groupId = b.kind === 'reply'
      ? (await admin.from('table_posts').select('group_id').eq('id', row.post_id).maybeSingle()).data?.group_id
      : row.group_id
    const { isTC } = await access(auth.userId, auth.role, groupId)
    const mine = row.author_id === auth.userId
    if (b.action === 'edit') {
      if (!mine) return NextResponse.json({ error: 'You can only edit your own' }, { status: 403 })
      const body = clean(b.body, 4000)
      if (!body) return NextResponse.json({ error: 'It cannot be empty' }, { status: 400 })
      const { error } = await admin.from(table).update({ body, edited_at: new Date().toISOString() }).eq('id', row.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    if (!mine && !isTC) return NextResponse.json({ error: 'Only the author or a TC can remove this' }, { status: 403 })
    const { error } = row.source === 'sunrise'
      ? await admin.from(table).update({ hidden: true }).eq('id', row.id)
      : await admin.from(table).delete().eq('id', row.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
