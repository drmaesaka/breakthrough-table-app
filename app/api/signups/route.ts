import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/api-auth'

// Signing up for / withdrawing from a table sign-up session (2026-10-29).
// Server-side for the same reason as RSVPs. The capacity trigger still runs
// with the service key, so "full" and "closed" come back in its own words.
// POST { session_id, on: boolean }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { session_id, on } = await req.json().catch(() => ({}))
  if (typeof session_id !== 'string') return NextResponse.json({ error: 'Bad session' }, { status: 400 })
  const admin = adminClient()
  const { error } = on
    ? await admin.from('signup_registrations').insert({ session_id, user_id: auth.userId })
    : await admin.from('signup_registrations').delete().eq('session_id', session_id).eq('user_id', auth.userId)
  if (error && error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
