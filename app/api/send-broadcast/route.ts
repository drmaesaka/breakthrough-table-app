import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership } from '@/lib/api-auth'
import { sendPush } from '@/lib/send-push'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_id, message } = await req.json().catch(() => ({}))
  if (!group_id || !message?.trim()) {
    return NextResponse.json({ error: 'group_id and message are required' }, { status: 400 })
  }

  // Checking the leader role alone let any leader push a notification to any
  // table in the app. The role is app-wide; ownership of this group is not.
  const owns = await requireGroupOwnership(auth.userId, group_id)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  const supabase = adminClient()

  const { data: members, error: membersError } = await supabase
    .from('profiles')
    .select('id')
    .eq('group_id', group_id)

  if (membersError) {
    return NextResponse.json({ error: 'Could not load members' }, { status: 500 })
  }
  if (!members || members.length === 0) {
    return NextResponse.json({ message: 'No members in group', sent: 0 })
  }

  const memberIds = members.map((m: any) => m.id)

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', memberIds)

  if (!subs || subs.length === 0) {
    return NextResponse.json({ message: 'No push subscriptions found', sent: 0 })
  }

  const results = await Promise.all(
    subs.map(async (sub: any) => {
      const result = await sendPush(sub, {
        title: 'Breakthrough Table',
        body: message.trim(),
      })
      if (result === 'expired') {
        // Delete the one dead device, not every subscription the member owns.
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      }
      return result
    })
  )

  const sent = results.filter(r => r === true).length
  return NextResponse.json({ sent, total: subs.length })
}
