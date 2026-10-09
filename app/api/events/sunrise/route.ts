import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/api-auth'
import { causeMachineConfigured } from '@/lib/cause-machine'
import { upcomingSunriseEvents } from '@/lib/sunrise-events'

// Events page's Sunrise Network events. Rules in lib/sunrise-events.ts.

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!causeMachineConfigured()) return NextResponse.json({ events: [], note: 'not configured' })
  try {
    const events = await upcomingSunriseEvents()
    return NextResponse.json({ events }, { headers: { 'Cache-Control': 'private, max-age=60' } })
  } catch (err) {
    console.error('sunrise events failed:', err)
    return NextResponse.json({ error: 'Could not reach Sunrise Network right now' }, { status: 502 })
  }
}
