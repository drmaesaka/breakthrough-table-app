import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership } from '@/lib/api-auth'

// Invite codes live in group_invites, which no client can read (RLS with no
// policies) — the only way a code reaches a browser is this route handing it
// to the group's own leader.

async function inviteLink(origin: string, groupId: string): Promise<{ url: string; revocable: boolean } | { error: string }> {
  const supabase = adminClient()

  const { data, error } = await supabase
    .from('group_invites')
    .select('code')
    .eq('group_id', groupId)
    .maybeSingle()

  // Before the migration runs there is no invite table; fall back to the
  // legacy link so the copy button never stops working.
  if (error && (error.code === '42P01' || /group_invites/.test(error.message))) {
    return { url: `${origin}/join?group=${groupId}`, revocable: false }
  }
  if (error) return { error: 'Could not load invite' }

  if (data) return { url: `${origin}/join?invite=${data.code}`, revocable: true }

  // Groups created after the migration seed their code here.
  const { data: created, error: insertError } = await supabase
    .from('group_invites')
    .insert({ group_id: groupId })
    .select('code')
    .single()
  if (insertError || !created) return { error: 'Could not create invite' }
  return { url: `${origin}/join?invite=${created.code}`, revocable: true }
}

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const groupId = url.searchParams.get('group_id')
  if (!groupId) return NextResponse.json({ error: 'group_id is required' }, { status: 400 })

  const owns = await requireGroupOwnership(auth.userId, groupId)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  const link = await inviteLink(url.origin, groupId)
  if ('error' in link) return NextResponse.json({ error: link.error }, { status: 500 })
  return NextResponse.json(link)
}

// Regenerate: the old link stops working immediately. This is the revocation
// story invite links never had.
export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id } = await req.json().catch(() => ({}))
  if (!group_id) return NextResponse.json({ error: 'group_id is required' }, { status: 400 })

  const owns = await requireGroupOwnership(auth.userId, group_id)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  const supabase = adminClient()
  const { error: deleteError } = await supabase
    .from('group_invites')
    .delete()
    .eq('group_id', group_id)

  if (deleteError && (deleteError.code === '42P01' || /group_invites/.test(deleteError.message))) {
    return NextResponse.json(
      { error: 'Invite codes need the 2026-07-29 SQL migration — run sql/2026-07-29-multi-table-and-push.sql first' },
      { status: 409 }
    )
  }
  if (deleteError) return NextResponse.json({ error: 'Could not revoke invite' }, { status: 500 })

  const link = await inviteLink(new URL(req.url).origin, group_id)
  if ('error' in link) return NextResponse.json({ error: link.error }, { status: 500 })
  return NextResponse.json(link)
}
