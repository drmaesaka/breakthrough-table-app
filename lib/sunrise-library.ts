// Sunrise Network content in the app's Library (2026-10-07).
//
// Everything posted under Sunrise's Admin → Content comes from Cause Machine's
// read-only API and is shown in Library, so nobody re-enters it. Members open
// it here without a Sunrise login:
//   documents → the file's direct link (Cause Machine hands it to us);
//   videos    → the YouTube/Loom/Canva embed. The API does not include it, so
//               it lives in sunrise_video_links: collected once from the
//               signed-in pages, and pasted by a TC in Admin for new videos;
//   articles  → the text itself, which the API does include.
//
// Who sees what, from Sunrise's own privacy setting:
//   Public / Community / MembershipLevel / Neighborhood → every member;
//   Group → only if it is an all-member group, the TC group (TCs only), or
//           the Sunrise group paired with one of the person's tables
//           (groups.sunrise_group_id, set in Admin → groups).
// Interest groups that are not paired with a table are left out.
//
// SERVER ONLY: uses the Cause Machine credentials and the service key.

import { fetchResources, fetchGroups, type CauseMachineResource } from './cause-machine'

/** Sunrise groups whose posts are for every member. */
const ALL_MEMBER_GROUPS = new Set([7010 /* All BT Members */, 6857 /* ALL Sunrise Network */])
/** Sunrise's TC group: its posts go to TCs only. */
const TC_GROUP = 6837 /* BT Leadership */
const OPEN_PRIVACY = new Set(['Public', 'Community', 'MembershipLevel', 'Neighborhood'])

export type SunriseItem = {
  id: string
  title: string
  kind: 'video' | 'document' | 'article'
  author: string | null
  date: string | null
  /** Short plain-text summary for the card. */
  summary: string
  /** Full plain text, articles only. */
  body: string | null
  /** video: embed URL (null until linked); document: file URL. */
  url: string | null
  /** The item's page on Sunrise (needs a Sunrise login unless Public). */
  sunriseUrl: string | null
  cover: string | null
  /** Posted to one Sunrise group (a table's, or the TCs'): who it is limited to, for a 🔒 label. */
  onlyFor: string | null
}

// Five minutes is fresh enough for a library and spares Cause Machine.
let cache: { at: number; rows: CauseMachineResource[]; groups: Map<number, string> } | null = null
const CACHE_MS = 5 * 60 * 1000

async function allResources(): Promise<{ rows: CauseMachineResource[]; groups: Map<number, string> }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache
  const [rows, gs] = await Promise.all([fetchResources(), fetchGroups().catch(() => [])])
  const groups = new Map<number, string>(gs.map(g => [Number(g.GroupId), String(g.Name || 'its group')]))
  cache = { at: Date.now(), rows, groups }
  return cache
}

/** HTML from Sunrise's editor to plain text with paragraph breaks. */
export function htmlToText(html: string | null): string {
  if (!html) return ''
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href, text) => text && !text.includes(href) ? `${text} (${href})` : href)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function sunriseItemsFor(opts: {
  isLeader: boolean
  /** Sunrise group ids paired with the person's tables. */
  sunriseGroupIds: Set<number>
  videoLinks: Map<string, string>
}): Promise<SunriseItem[]> {
  const now = Date.now()
  const out: SunriseItem[] = []
  const { rows, groups } = await allResources()
  for (const r of rows) {
    if (r.Status !== 'Published') continue
    if (r.DateExpires && new Date(r.DateExpires).getTime() < now) continue
    const privacy = r.Privacy || ''
    const gid = Number(r.GroupId || 0)
    const visible = OPEN_PRIVACY.has(privacy)
      || (privacy === 'Group' && (ALL_MEMBER_GROUPS.has(gid) || opts.sunriseGroupIds.has(gid) || (gid === TC_GROUP && opts.isLeader)))
    if (!visible) continue

    const type = (r.ResourceType || '').toLowerCase()
    const kind: SunriseItem['kind'] = type === 'video' ? 'video' : type === 'document' ? 'document' : 'article'
    const text = htmlToText(r.Description)
    const community = Array.isArray(r.Communities) ? r.Communities[0] : null
    const id = String(r.ResourceId)
    out.push({
      id,
      title: (r.Title || 'Untitled').trim(),
      kind,
      author: community?.Author || null,
      date: r.DatePublished,
      summary: text.slice(0, 160),
      body: kind === 'article' ? text : null,
      url: kind === 'video' ? opts.videoLinks.get(id) || null : kind === 'document' ? r.FileUrl : null,
      sunriseUrl: community?.ResourceUrl || null,
      cover: r.CoverPhotoUrl,
      onlyFor: privacy === 'Group' && !ALL_MEMBER_GROUPS.has(gid)
        ? (gid === TC_GROUP ? 'TCs' : groups.get(gid) || 'its group')
        : null,
    })
  }
  out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  return out
}

/** A pasted YouTube / Loom / Vimeo / Canva link as an embeddable URL, or null. */
export function toEmbedUrl(raw: string): string | null {
  const url = raw.trim()
  const yt = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`
  const loom = url.match(/loom\.com\/(?:share|embed)\/([a-f0-9]{32})/)
  if (loom) return `https://www.loom.com/embed/${loom[1]}`
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`
  const canva = url.match(/canva\.com\/design\/([^/]+)\/([^/]+)\//)
  if (canva) return `https://www.canva.com/design/${canva[1]}/${canva[2]}/watch?embed`
  return null
}
