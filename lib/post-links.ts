// A follow-up's links (2026-10-20). table_posts.link_url held one URL; a TC
// sending five optional videos needed more. Several links are stored in the
// same column as a JSON list of { label, url }; a plain URL (older posts,
// Sunrise copies) still reads as one link. No migration needed.

export type PostLink = { label: string | null; url: string }

export function parseLinks(raw: string | null | undefined): PostLink[] {
  if (!raw) return []
  if (raw.trim().startsWith('[')) {
    try {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) return list.filter(l => l && typeof l.url === 'string').map(l => ({ label: l.label || null, url: l.url }))
    } catch { /* fall through to a plain URL */ }
  }
  return [{ label: null, url: raw }]
}

/** What a link button says when it has no label: its site, e.g. "youtube.com". */
export function linkName(l: PostLink): string {
  if (l.label) return l.label
  try { return new URL(l.url).hostname.replace(/^www\./, '') } catch { return 'Open link' }
}
