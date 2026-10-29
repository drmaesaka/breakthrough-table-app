import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '@/lib/api-auth'
import { sendEmail } from '@/lib/send-email'
import { localDay } from '@/lib/dates'

// Save-and-read audit (2026-10-29). Run by cron-job.org with the nudge secret.
//
// Silent failures are this app's worst bug class: a database policy can make
// a save report success while storing nothing, or a read come back empty, and
// nobody notices until a member does (2026-10-28: every Home screen and the
// Admin tab vanished overnight). This signs in as the Tester account on the
// server, does what a member's phone does — reads, saves through our routes,
// the browser saves that are left — checks each one actually landed, undoes
// it, and emails HEALTH_ALERT_EMAIL only if something failed.
//
// POST /api/health/writes            Authorization: Bearer <NUDGE_SECRET>
// POST /api/health/writes?quiet=1    no email, just the JSON report
//
// Tester is found by name ("Tester") unless HEALTH_USER_ID is set.

export const maxDuration = 60
const MARK = '__health-check'

type Step = { step: string; ok: boolean; detail?: string }

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }

async function run(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.NUDGE_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const quiet = req.nextUrl.searchParams.get('quiet') === '1'
  const origin = req.nextUrl.origin
  const admin = adminClient()
  const steps: Step[] = []
  const pass = (step: string, detail?: string) => steps.push({ step, ok: true, detail })
  const fail = (step: string, detail: string) => steps.push({ step, ok: false, detail })

  // Each check runs on its own so one failure does not hide the rest.
  async function check(step: string, fn: () => Promise<string | void>) {
    try { const d = await fn(); pass(step, d || undefined) } catch (e: any) { fail(step, e?.message || String(e)) }
  }
  const must = (cond: unknown, msg?: string) => { if (!cond) throw new Error(msg || "failed") }

  // --- Sign in as Tester -------------------------------------------------
  let me = '', token = '', user: SupabaseClient | null = null, groupId: string | null = null
  await check('sign in as Tester', async () => {
    let id = process.env.HEALTH_USER_ID || ''
    if (!id) {
      const { data } = await admin.from('profiles').select('id').eq('full_name', 'Tester').limit(2)
      must(data?.length === 1, `expected one profile named Tester, found ${data?.length ?? 0}`)
      id = data![0].id
    }
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(id)
    must(u?.user?.email, `no auth user for Tester (${uErr?.message || 'no email'})`)
    // generateLink never sends an email; the hashed token is exchanged here.
    const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user!.email! })
    const hashed = link?.properties?.hashed_token
    must(hashed, `could not make a sign-in link: ${lErr?.message}`)
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    const { data: s, error: sErr } = await anon.auth.verifyOtp({ token_hash: hashed!, type: 'magiclink' })
    must(s?.session?.access_token, `sign-in failed: ${sErr?.message}`)
    me = id
    token = s.session!.access_token
    user = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
  })
  if (!user) return report(steps, quiet)
  const u = user as SupabaseClient
  const api = async (path: string, method: string, body: unknown) => {
    const res = await fetch(origin + path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${path} answered ${res.status}: ${json.error || ''}`)
    return json
  }

  // --- Reads the phone still does itself ---------------------------------
  // A policy that stops matching makes these come back empty, not error.
  await check('read own profile (phone)', async () => {
    const { data, error } = await u.from('profiles').select('id, group_id').eq('id', me).maybeSingle()
    must(!error, error?.message); must(data, 'came back empty — Home buttons and Admin would vanish')
    groupId = data!.group_id
  })
  for (const [table, what] of [['profiles', 'other members'], ['events', 'events'], ['rooms', 'rooms'], ['habits', 'own habits']] as const) {
    await check(`read ${what} (phone)`, async () => {
      const own = table === 'habits'
      let sq = admin.from(table).select('id', { count: 'exact', head: true })
      let uq = u.from(table).select('id', { count: 'exact', head: true })
      if (own) { sq = sq.eq('user_id', me); uq = uq.eq('user_id', me) }
      const [{ count: sc, error: sErr }, { count: uc, error: uErr }] = await Promise.all([sq, uq])
      must(!sErr, `server read failed: ${sErr?.message}`)
      must(!uErr, uErr?.message)
      must(!(sc && !uc), `phone sees 0 of ${sc}`)
      return `${uc} visible`
    })
  }
  await check('read table chat (phone)', async () => {
    if (!groupId) return 'Tester has no table — skipped'
    const [{ count: sc }, { count: uc, error }] = await Promise.all([
      admin.from('messages').select('id', { count: 'exact', head: true }).eq('group_id', groupId),
      u.from('messages').select('id', { count: 'exact', head: true }).eq('group_id', groupId),
    ])
    must(!error, error?.message); must(!(sc && !uc), `phone sees 0 of ${sc} messages`)
    return `${uc} visible`
  })

  // --- Saves through our routes -------------------------------------------
  await check('save profile (server)', async () => {
    const { data: before } = await admin.from('profiles').select('bio').eq('id', me).single()
    const probe = `${MARK} ${Date.now()}`
    try {
      await api('/api/me', 'PATCH', { bio: probe })
      const { data: after } = await admin.from('profiles').select('bio').eq('id', me).single()
      must(after?.bio === probe, 'reported saved but the bio did not change')
    } finally {
      await admin.from('profiles').update({ bio: before?.bio ?? null }).eq('id', me)
    }
  })
  await check('habit add / check / uncheck (server)', async () => {
    let habitId = ''
    try {
      const { habit } = await api('/api/habits', 'POST', { action: 'add', name: MARK, frequency: 'daily' })
      habitId = habit?.id; must(habitId, 'no habit came back')
      const today = localDay()
      await api('/api/habits', 'POST', { action: 'check', habit_id: habitId, date: today })
      const { count: c1 } = await admin.from('habit_completions').select('*', { count: 'exact', head: true }).eq('habit_id', habitId)
      must(c1 === 1, `check-off reported saved but ${c1} rows exist`)
      await api('/api/habits', 'POST', { action: 'uncheck', habit_id: habitId, dates: [today] })
      const { count: c2 } = await admin.from('habit_completions').select('*', { count: 'exact', head: true }).eq('habit_id', habitId)
      must(c2 === 0, 'uncheck reported saved but the check-off is still there')
    } finally {
      await admin.from('habit_completions').delete().eq('user_id', me).eq('habit_id', habitId || '00000000-0000-0000-0000-000000000000')
      await admin.from('habits').delete().eq('user_id', me).eq('name', MARK)
    }
  })
  await check('send a direct message (server)', async () => {
    // Tester to Tester, so nobody else ever sees it.
    let { data: convo } = await admin.from('dm_conversations').select('id').eq('participant_1', me).eq('participant_2', me).maybeSingle()
    if (!convo) {
      const { data, error } = await admin.from('dm_conversations').insert({ participant_1: me, participant_2: me }).select('id').single()
      if (error) return `skipped — a self conversation is not allowed (${error.message})`
      convo = data
    }
    const { id } = await api('/api/dms', 'POST', { conversation_id: convo!.id, content: MARK })
    try {
      const { data } = await admin.from('direct_messages').select('id').eq('id', id).maybeSingle()
      must(data, 'reported sent but the message is not there')
    } finally {
      await admin.from('direct_messages').delete().eq('conversation_id', convo!.id)
    }
  })

  // --- Saves the phone still does itself ----------------------------------
  // .select() on every write: a policy-filtered update/delete returns no rows
  // instead of an error, which is exactly the silent failure.
  await check('to-do add / tick / delete (phone)', async () => {
    try {
      const { data: ins, error: e1 } = await u.from('personal_items').insert({ user_id: me, title: MARK }).select('id')
      must(!e1, `add failed: ${e1?.message}`); must(ins?.length === 1, 'add stored nothing')
      const id = ins![0].id
      const { data: up, error: e2 } = await u.from('personal_items').update({ done_at: new Date().toISOString() }).eq('id', id).select('id')
      must(!e2, `tick failed: ${e2?.message}`); must(up?.length === 1, 'tick reported saved but changed nothing')
      const { data: del, error: e3 } = await u.from('personal_items').delete().eq('id', id).select('id')
      must(!e3, `delete failed: ${e3?.message}`); must(del?.length === 1, 'delete reported done but removed nothing')
    } finally {
      await admin.from('personal_items').delete().eq('user_id', me).eq('title', MARK)
    }
  })

  return report(steps, quiet)
}

async function report(steps: Step[], quiet: boolean) {
  const failed = steps.filter(s => !s.ok)
  if (failed.length && !quiet && process.env.HEALTH_ALERT_EMAIL) {
    const lines = steps.map(s => `${s.ok ? '✓' : '✗'} ${s.step}${s.detail ? ` — ${s.detail}` : ''}`)
    await sendEmail({
      to: process.env.HEALTH_ALERT_EMAIL,
      subject: `Breakthrough Table: ${failed.length} save check${failed.length === 1 ? '' : 's'} failed`,
      text: `The automatic save test found a problem before any member did.\n\n${lines.join('\n')}\n\nOpen Claude in the breakthrough-table-app folder and paste this email.`,
    }).catch(err => console.error('health alert email failed:', err))
  }
  if (failed.length) console.error('[health-writes] failed:', JSON.stringify(failed))
  // 500 on any failure so the cron job's own history turns red and
  // cron-job.org sends its failure email too, not only ours.
  return NextResponse.json({ ok: failed.length === 0, failed: failed.length, steps }, { status: failed.length ? 500 : 200 })
}
