import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser, leaderGroupIds } from '@/lib/api-auth'
import { causeMachineConfigured } from '@/lib/cause-machine'
import { sunriseItemsFor } from '@/lib/sunrise-library'

// Library's "From Sunrise Network" section: what this person may see of the
// content posted on Sunrise. Rules in lib/sunrise-library.ts.

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!causeMachineConfigured()) return NextResponse.json({ items: [], note: 'not configured' })

  const admin = adminClient()
  const isLeader = auth.role === 'leader'
  const { data: prof } = await admin.from('profiles').select('group_id').eq('id', auth.userId).maybeSingle()
  const tableIds = new Set<string>(prof?.group_id ? [prof.group_id] : [])
  if (isLeader) for (const id of await leaderGroupIds(auth.userId)) tableIds.add(id)

  // Both reads tolerate the 2026-10-07 migration not having run yet.
  const [{ data: groups }, { data: links }] = await Promise.all([
    tableIds.size ? admin.from('groups').select('sunrise_group_id').in('id', [...tableIds]) : Promise.resolve({ data: [] as any[] }),
    admin.from('sunrise_video_links').select('resource_id, embed_url'),
  ])
  const sunriseGroupIds = new Set<number>((groups || []).map((g: any) => Number(g.sunrise_group_id)).filter(Boolean))
  const videoLinks = new Map<string, string>((links || []).map((l: any) => [String(l.resource_id), l.embed_url]))

  try {
    const items = await sunriseItemsFor({ isLeader, sunriseGroupIds, videoLinks })
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, max-age=60' } })
  } catch (err) {
    console.error('sunrise library failed:', err)
    return NextResponse.json({ error: 'Could not reach Sunrise Network right now' }, { status: 502 })
  }
}
