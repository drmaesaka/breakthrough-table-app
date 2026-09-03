import { sendPush } from '@/lib/send-push'
import { sendEmail, notificationEmail } from '@/lib/send-email'
import { fetchMemberEmails } from '@/lib/member-emails'

// Event notifications: a chat message, a DM, new reading, a new prompt, a
// new library item. Push where the member has it, email where not (only for
// the kinds worth an email), never both — the same rule the nudge jobs use.
//
// Triggered by /api/notify right after the browser writes the row, and by
// /api/messages for a leader posting in their second table. Not by a
// database trigger: those live only in the Supabase console and cannot be
// audited from the repo.

export type NotifyKind = 'chat' | 'dm' | 'task' | 'prompt' | 'content' | 'broadcast'

type Prefs = { notify_chat: boolean; notify_dms: boolean; notify_updates: boolean }
const ALL_ON: Prefs = { notify_chat: true, notify_dms: true, notify_updates: true }

// A leader's broadcast has no switch: it is the one thing a member cannot
// opt out of short of turning notifications off on the device.
const PREF_KEY: Record<Exclude<NotifyKind, 'broadcast'>, keyof Prefs> = {
  chat: 'notify_chat', dm: 'notify_dms', task: 'notify_updates', prompt: 'notify_updates', content: 'notify_updates',
}

/** Chat bursts collapse to one notification: nothing more for this many ms after a prior message. */
export const BURST_WINDOW_MS = 10 * 60 * 1000

export async function memberPrefs(admin: any, userIds: string[]): Promise<Map<string, Prefs>> {
  const out = new Map<string, Prefs>()
  if (!userIds.length) return out
  const { data, error } = await admin
    .from('nudge_preferences')
    .select('user_id, notify_chat, notify_dms, notify_updates')
    .in('user_id', userIds)
  // Before the 2026-09-03 migration the columns do not exist: everyone is on.
  if (error) { console.error('notify: prefs lookup failed, treating all as on:', error.message); return out }
  for (const r of data || []) {
    out.set(r.user_id, {
      notify_chat: r.notify_chat !== false,
      notify_dms: r.notify_dms !== false,
      notify_updates: r.notify_updates !== false,
    })
  }
  return out
}

export async function notifyMembers(admin: any, args: {
  kind: NotifyKind
  recipientIds: string[]
  title: string
  body: string
  url: string
  /** Email those without push? Off for table chat — a burst of chat emails is noise. */
  emailFallback: boolean
  emailCta?: string
}) {
  const recipients = [...new Set(args.recipientIds)]
  if (!recipients.length) return { pushed: 0, emailed: 0, skipped: 0 }

  const prefs = args.kind === 'broadcast' ? new Map<string, Prefs>() : await memberPrefs(admin, recipients)
  const wanted = args.kind === 'broadcast'
    ? recipients
    : recipients.filter(id => (prefs.get(id) || ALL_ON)[PREF_KEY[args.kind as Exclude<NotifyKind, 'broadcast'>]])
  const skipped = recipients.length - wanted.length
  if (!wanted.length) return { pushed: 0, emailed: 0, skipped }

  const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', wanted)
  const subsByUser = new Map<string, any[]>()
  for (const s of subs || []) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) || []), s])

  let pushed = 0
  await Promise.all(
    (subs || []).map(async (sub: any) => {
      const r = await sendPush(sub, { title: args.title, body: args.body, url: args.url })
      if (r === true) pushed++
      if (r === 'expired') await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    })
  )

  let emailed = 0
  if (args.emailFallback) {
    const withoutPush = wanted.filter(id => !subsByUser.has(id))
    if (withoutPush.length) {
      const [emails, { data: names }] = await Promise.all([
        fetchMemberEmails(admin, withoutPush),
        admin.from('profiles').select('id, full_name').in('id', withoutPush),
      ])
      const nameOf = new Map<string, string>((names || []).map((p: any) => [p.id, p.full_name || 'there']))
      await Promise.all(withoutPush.map(async id => {
        const to = emails.get(id)
        if (!to) return
        const msg = notificationEmail({
          memberName: (nameOf.get(id) || 'there').split(' ')[0],
          subject: args.title,
          body: args.body,
          ctaLabel: args.emailCta || 'Open Breakthrough Table',
          ctaPath: args.url,
        })
        const res = await sendEmail({ to, ...msg })
        if (res.sent) emailed++
      }))
    }
  }
  return { pushed, emailed, skipped }
}

/** Everyone who should hear about a table's activity: its members plus its leaders, minus one person. */
export async function tableAudience(admin: any, groupId: string, exceptUserId: string): Promise<string[]> {
  const [{ data: members }, { data: legacy }, { data: co }] = await Promise.all([
    admin.from('profiles').select('id').eq('group_id', groupId),
    admin.from('groups').select('leader_id').eq('id', groupId).maybeSingle(),
    admin.from('group_leaders').select('user_id').eq('group_id', groupId),
  ])
  const ids = new Set<string>((members || []).map((m: any) => m.id))
  if (legacy?.leader_id) ids.add(legacy.leader_id)
  for (const r of co || []) ids.add(r.user_id)
  ids.delete(exceptUserId)
  return [...ids]
}

/**
 * A table chat message. Skipped when another message landed in the same
 * table within the burst window — the first message of a conversation pings
 * people, the next twenty do not.
 */
export async function notifyTableChat(admin: any, message: { id: string; group_id: string; user_id: string; content: string; created_at: string }) {
  const since = new Date(new Date(message.created_at).getTime() - BURST_WINDOW_MS).toISOString()
  const { data: prior } = await admin
    .from('messages').select('id')
    .eq('group_id', message.group_id)
    .neq('id', message.id)
    .gte('created_at', since)
    .lt('created_at', message.created_at)
    .limit(1)
  if (prior && prior.length) return { pushed: 0, emailed: 0, skipped: 0, burst: true }

  const [{ data: group }, { data: sender }] = await Promise.all([
    admin.from('groups').select('name').eq('id', message.group_id).maybeSingle(),
    admin.from('profiles').select('full_name').eq('id', message.user_id).maybeSingle(),
  ])
  const recipientIds = await tableAudience(admin, message.group_id, message.user_id)
  return notifyMembers(admin, {
    kind: 'chat',
    recipientIds,
    title: `💬 ${group?.name || 'Table Chat'}`,
    body: `${(sender?.full_name || 'Someone').split(' ')[0]}: ${message.content.slice(0, 140)}`,
    url: '/messages',
    emailFallback: false,
  })
}
