import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, leaderGroupIds } from '@/lib/api-auth'
import { sendEmail } from '@/lib/send-email'
import { fetchMemberEmails } from '@/lib/member-emails'

export const maxDuration = 60

// Emails everyone at the caller's tables who has no push subscription the
// exact steps to turn notifications on. Leaders asked for a lever: most
// members had not switched notifications on and the only prompt was a
// dashboard banner they had dismissed once. iPhone steps first, because that
// is where the extra Home Screen step trips people.

const APP = () => process.env.NEXT_PUBLIC_APP_URL || 'https://breakthrough-table-app.vercel.app'

function reminderEmail(firstName: string, leaderName: string) {
  const app = APP()
  return {
    subject: 'Turn on Breakthrough Table notifications (2 minutes)',
    text: [
      `Hi ${firstName},`,
      '',
      `${leaderName} asked us to send this. Right now your Breakthrough Table app can't reach you — no nudges, no table chat, no reminders from your TC. Two minutes fixes it.`,
      '',
      'ON AN IPHONE',
      `1. Open Safari and go to ${app}`,
      '2. Tap the Share button (the square with an arrow, bottom of the screen)',
      '3. Scroll down and tap "Add to Home Screen", then "Add"',
      '4. Close Safari. Open Breakthrough Table from your Home Screen (the new icon) and sign in there',
      '5. When it asks, tap "Allow Notifications"',
      '',
      'ON ANDROID',
      `1. Open Chrome and go to ${app}`,
      '2. Sign in, then tap "Allow Notifications" on the home screen of the app',
      '3. If Chrome asks, choose Allow',
      '',
      `Already did this and still nothing? Open the app, go to Profile → Nudge Settings and tap "Send Test". If it says notifications are blocked, your phone's Settings → Notifications → Breakthrough Table needs to be switched on.`,
      '',
      '— Breakthrough Table',
    ].join('\n'),
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { dry } = await req.json().catch(() => ({}))
  const supabase = adminClient()
  const mine = await leaderGroupIds(auth.userId)
  if (!mine.length) return NextResponse.json({ recipients: [], emailed: 0, unreachable: [] })

  const [{ data: members }, { data: me }] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('group_id', mine),
    supabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle(),
  ])
  const ids = (members || []).map(m => m.id).filter(id => id !== auth.userId)
  const { data: subs } = ids.length
    ? await supabase.from('push_subscriptions').select('user_id').in('user_id', ids)
    : { data: [] as { user_id: string }[] }
  const withPush = new Set((subs || []).map(s => s.user_id))
  const targets = (members || []).filter(m => ids.includes(m.id) && !withPush.has(m.id))
  if (!targets.length) return NextResponse.json({ recipients: [], emailed: 0, unreachable: [] })

  const emails = await fetchMemberEmails(supabase, targets.map(t => t.id))
  const leaderName = me?.full_name?.split(' ')[0] || 'Your TC'
  const unreachable: string[] = []
  let emailed = 0
  await Promise.all(targets.map(async t => {
    const to = emails.get(t.id)
    if (!to) { unreachable.push(t.full_name || 'Unnamed'); return }
    if (dry) { emailed++; return }
    const res = await sendEmail({ to, ...reminderEmail((t.full_name || 'there').split(' ')[0], leaderName) })
    if (res.sent) emailed++
    else unreachable.push(t.full_name || 'Unnamed')
  }))
  return NextResponse.json({ recipients: targets.map(t => t.full_name), emailed, unreachable, dry: Boolean(dry) })
}
