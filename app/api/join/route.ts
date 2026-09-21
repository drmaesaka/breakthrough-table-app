import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { adminClient } from '@/lib/api-auth'

// Joining a table goes through here with the service key: the DB trigger
// (profiles_lock_group) stops the browser writing profiles.group_id, which is
// what let a member self-assign into any table whose id they knew.
//
// Two link formats:
//   ?invite=<code>  — validated against group_invites; the leader can revoke a
//                     link by regenerating the code.
//   ?group=<id>     — the legacy format. Accepted only while the group_invites
//                     table does not exist yet, so old links keep working until
//                     the migration runs, then automatically stop.

/** 'ready' once the invite table exists, 'legacy' before the migration runs. */
async function inviteMode(): Promise<'ready' | 'legacy'> {
  const { error } = await adminClient().from('group_invites').select('group_id').limit(1)
  // 42P01 = relation does not exist. PostgREST surfaces it with the table name
  // in the message; either signal means the migration has not run yet.
  if (error && (error.code === '42P01' || /group_invites/.test(error.message))) return 'legacy'
  return 'ready'
}

async function resolveGroup(invite: string | null, legacyGroupId: string | null) {
  const supabase = adminClient()
  const mode = await inviteMode()

  if (invite && mode === 'ready') {
    // Codes are uuids. Anything else is a link that got cut short or altered
    // on its way through a messaging app — a different fix from a revoked
    // code, so say so.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invite)) {
      return { error: 'This invite link looks incomplete — ask your leader to send it again' }
    }
    const { data } = await supabase
      .from('group_invites')
      .select('group_id')
      .eq('code', invite)
      .maybeSingle()
    if (!data) return { error: 'This invite link is no longer valid' }
    const { data: group } = await supabase
      .from('groups').select('id, name').eq('id', data.group_id).maybeSingle()
    return group ? { group } : { error: 'This invite link is no longer valid' }
  }

  if (legacyGroupId && mode === 'legacy') {
    const { data: group } = await supabase
      .from('groups').select('id, name').eq('id', legacyGroupId).maybeSingle()
    return group ? { group } : { error: 'Group not found' }
  }

  if (legacyGroupId && mode === 'ready') {
    return { error: 'This invite link has expired — ask your leader for a new one' }
  }

  return { error: 'Missing invite code' }
}

// Preview for the join page: which table does this link belong to?
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const resolved = await resolveGroup(url.searchParams.get('invite'), url.searchParams.get('group'))
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 404 })
  return NextResponse.json({ group_name: resolved.group!.name })
}

// The actual join: the freshly signed-up member presents their own token plus
// the invite, and the server writes group_id for them.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.slice('Bearer '.length)
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  // A token minted seconds ago is exactly the one Supabase intermittently
  // rejects as "issued in the future" (clock skew — the same thing that made
  // the cron jobs 503). Four sign-ups in one evening hit an error here, so
  // retry briefly before telling a brand-new member their join failed.
  let user = null as null | { id: string }
  for (let attempt = 0; attempt < 4 && !user; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 700))
    const { data } = await userClient.auth.getUser(token)
    user = data.user
  }
  if (!user) return NextResponse.json({ error: 'Your sign-in was not ready yet' }, { status: 401 })

  const { invite, group } = await req.json().catch(() => ({}))
  const resolved = await resolveGroup(invite || null, group || null)
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 })

  // A member already seated at a table cannot move themselves with a link —
  // reassignment is the leader's call in Admin → Members.
  const supabase = adminClient()
  const { data: prof } = await supabase
    .from('profiles').select('group_id').eq('id', user.id).maybeSingle()
  if (prof?.group_id && prof.group_id !== resolved.group!.id) {
    return NextResponse.json({ error: 'You are already in a table — ask a leader to move you' }, { status: 409 })
  }

  // The profile row is created by a database trigger when the account is;
  // confirm the update actually touched a row, and give the trigger a
  // moment if it has not landed yet. An update matching nothing returns no
  // error and used to read as success.
  let seated = false
  for (let attempt = 0; attempt < 4 && !seated; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 600))
    const { data, error } = await supabase
      .from('profiles')
      .update({ group_id: resolved.group!.id })
      .eq('id', user.id)
      .select('id')
    if (error) return NextResponse.json({ error: 'Could not join the group' }, { status: 500 })
    seated = Boolean(data && data.length)
  }
  if (!seated) return NextResponse.json({ error: 'Your profile was not ready yet' }, { status: 503 })
  return NextResponse.json({ ok: true, group_name: resolved.group!.name })
}
