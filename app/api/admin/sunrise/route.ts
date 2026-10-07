import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader } from '@/lib/api-auth'
import { fetchGroups, fetchResources, causeMachineConfigured } from '@/lib/cause-machine'
import { toEmbedUrl } from '@/lib/sunrise-library'

// TC tools for the Sunrise content in Library:
//   GET  → Sunrise groups (to pair with tables) and published videos that
//          have no playable link yet;
//   POST { resource_id, url } → save a video's YouTube/Loom/Vimeo link.

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!causeMachineConfigured()) return NextResponse.json({ groups: [], unlinked: [] })
  try {
    const [groups, resources, { data: links }] = await Promise.all([
      fetchGroups(),
      fetchResources(),
      adminClient().from('sunrise_video_links').select('resource_id'),
    ])
    const linked = new Set((links || []).map((l: any) => String(l.resource_id)))
    return NextResponse.json({
      groups: groups.filter(g => g.Status === 'Published').map(g => ({ id: String(g.GroupId), name: (g.Name || '').trim() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      unlinked: resources
        .filter(r => r.Status === 'Published' && (r.ResourceType || '').toLowerCase() === 'video' && !linked.has(String(r.ResourceId)))
        .map(r => ({ id: String(r.ResourceId), title: r.Title, sunriseUrl: r.Communities?.[0]?.ResourceUrl || null })),
    })
  } catch (err) {
    console.error('sunrise admin failed:', err)
    return NextResponse.json({ error: 'Could not reach Sunrise Network right now' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { resource_id, url } = await req.json().catch(() => ({}))
  if (!resource_id || typeof url !== 'string') return NextResponse.json({ error: 'resource_id and url are required' }, { status: 400 })
  const embed = toEmbedUrl(url)
  if (!embed) return NextResponse.json({ error: "That doesn't look like a YouTube, Loom, Vimeo or Canva link" }, { status: 400 })
  const { error } = await adminClient().from('sunrise_video_links')
    .upsert({ resource_id: String(resource_id), embed_url: embed, updated_by: auth.userId, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: 'Could not save', detail: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, embed_url: embed })
}
