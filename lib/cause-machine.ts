// Read-only client for Cause Machine, which holds Breakthrough Table's real
// membership and payment records.
//
// WHY THIS EXISTS
// Cause Machine is the system of record for members, payments and email lists,
// and it does not surface any of it usefully — so Mo reconciles by hand. Same
// shape of problem as Skedda was for rooms. This module is the read half of
// closing that gap: it does not replace Cause Machine, it makes what is already
// in there visible.
//
// VERIFIED AGAINST THE LIVE API 2026-08-03: 221 members, 1,510 payments dating
// back to 2025-06-02, 0 recurring donations.
//
// THE API IS READ-ONLY. Apart from webhook management there are no write
// endpoints — no way to create or update a member, apply a tag, or set a custom
// field. Anything that needs to *write* to Cause Machine cannot be built here,
// and that includes drip-email tag management. Do not promise it.
//
// SERVER-ONLY. Both env vars are unprefixed deliberately; a NEXT_PUBLIC_ on
// either would ship credentials for the whole membership database to every
// browser that loads the app.

import { classify, lineKey, type Business } from './business-lines'

const BASE = 'https://api.causemachine.com'

/** The API caps a page at 200 regardless of what pageSize you ask for. */
const MAX_PAGE_SIZE = 200

/** Stop runaway paging if the API ever reports a total it will not deliver. */
const MAX_PAGES = 200

export function causeMachineConfigured(): boolean {
  return Boolean(process.env.CAUSE_MACHINE_APP_ID && process.env.CAUSE_MACHINE_KEY)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Tokens last 20 minutes. Cached in module scope so a page doing three reads
// authenticates once rather than three times. This is per-instance and dies
// with the lambda, which is correct — it is a cache, not a store.
let cachedToken: { value: string; expiresAt: number } | null = null

/**
 * The in-flight authentication, shared by every caller that arrives before it
 * resolves.
 *
 * The value cache above only helps once a token exists. On a cold lambda the
 * summary view fires three reads at once, all three miss the empty cache, and
 * all three authenticate — three round-trips for one token. Production logged
 * exactly that on 2026-08-10: "auth returned 500" three times in parallel, one
 * per redundant call.
 *
 * Holding the promise rather than the result collapses them into one request.
 * Fewer calls, less latency, and a third of the exposure to whatever is making
 * their token endpoint intermittently 500 from Vercel's network.
 */
let inFlightAuth: Promise<string> | null = null

/** Refresh 60s early so a token cannot expire mid-request. */
const EXPIRY_MARGIN_MS = 60_000

/**
 * Cause Machine answers every credential problem with a 400 — wrong secret,
 * unknown id, empty value, stray whitespace, all of them. Measured against the
 * live endpoint 2026-08-10. So a 5xx is never "your key is wrong"; it is their
 * server having a moment, and it is worth waiting out.
 *
 * That distinction is the whole point of retrying only on 5xx: retrying a 400
 * would hammer their auth endpoint with credentials it has already rejected, and
 * would turn a clear "fix your key" into a slow, confusing failure.
 */
const AUTH_RETRIES = 2
const AUTH_RETRY_DELAY_MS = 400

function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return Promise.resolve(cachedToken.value)
  if (inFlightAuth) return inFlightAuth

  // Cleared in both directions: a failed auth must not be handed to the next
  // caller forever, and a successful one is superseded by the value cache.
  inFlightAuth = authenticate().finally(() => { inFlightAuth = null })
  return inFlightAuth
}

async function authenticate(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.CAUSE_MACHINE_APP_ID!,
    client_secret: process.env.CAUSE_MACHINE_KEY!,
  })

  let res: Response | null = null

  for (let attempt = 0; attempt <= AUTH_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, AUTH_RETRY_DELAY_MS * attempt))
    }

    res = await fetch(`${BASE}/Token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (res.ok) break
    // A rejected credential will be rejected again. Fail immediately so the
    // dashboard says something true and actionable.
    if (res.status < 500) break
    console.warn(`Cause Machine auth returned ${res.status}, attempt ${attempt + 1} of ${AUTH_RETRIES + 1}`)
  }

  if (!res || !res.ok) {
    // Never include the response body: on a credentials failure it can echo
    // back what was sent. The status alone separates the two real cases, and
    // the message has to make sense to whoever is looking at the dashboard.
    const status = res?.status ?? 0
    throw new Error(
      status >= 500
        ? `Cause Machine is not responding (HTTP ${status} after ${AUTH_RETRIES + 1} attempts). This is their end, not your credentials — try again shortly.`
        : `Cause Machine rejected the credentials (HTTP ${status}). Check CAUSE_MACHINE_APP_ID and CAUSE_MACHINE_KEY.`
    )
  }

  const json = await res.json()
  if (!json?.access_token) throw new Error('Cause Machine auth returned no token')

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(0, (json.expires_in ?? 1200) * 1000 - EXPIRY_MARGIN_MS),
  }
  return cachedToken.value
}

// ---------------------------------------------------------------------------
// Types — field names are Cause Machine's own PascalCase, left as-is so what is
// on the wire and what is in the code are the same thing.
// ---------------------------------------------------------------------------

export type PageInfo = { TotalRecords: number; Page: number; PageSize: number }

export type CauseMachineMember = {
  UserId: number
  FirstName: string | null
  LastName: string | null
  UserName: string | null
  Email: string | null
  UnsubscribedFromNewsLetter: boolean
  Communities: unknown[]
}

export type CauseMachinePayment = {
  PaymentId: number
  UserId: number
  EventId: number | null
  SubscriptionId: number | null
  DonationId: number | null
  /** Refunds arrive as negative amounts, so sums net out correctly. */
  Amount: number
  Fees: number
  /** ISO 8601 UTC, e.g. '2026-08-03T17:21:55.857Z'. */
  DateCompleted: string
  Status: string
  Type: string
  Description: string | null
  CCLast4: string | null
  Order: { OrderId?: number; OrderNumber?: string; Status?: string; OrderTotal?: number } | null
}

/**
 * Only the fields that matter for attributing ticket revenue. The full record
 * also carries venue, address and image URLs.
 *
 * OrganizationName is deliberately NOT used to split the businesses: every one
 * of the 80 events reports "Sunrise Network", because that is the organisation
 * the Cause Machine account itself belongs to. The Name is the real signal.
 */
export type CauseMachineEvent = {
  EventId: number
  Name: string | null
  OrganizationName: string | null
  StartDate: string | null
  Status: string | null
}

type Envelope<T> = { PageInfo: PageInfo; Results: T[] }

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function getPage<T>(
  path: string,
  params: Record<string, string | number>,
  page: number
): Promise<Envelope<T>> {
  const token = await getToken()
  const qs = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    page: String(page),
    pageSize: String(MAX_PAGE_SIZE),
  })

  const res = await fetch(`${BASE}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    // Membership and payment data is not static, and Next would otherwise cache
    // this indefinitely and show Mo a figure from whenever the page was built.
    cache: 'no-store',
  })

  if (res.status === 401) {
    // The cached token was rejected — drop it so the next call re-authenticates
    // rather than looping on a token the server has already invalidated.
    cachedToken = null
    throw new Error('Cause Machine rejected the access token')
  }
  if (!res.ok) throw new Error(`Cause Machine ${path} failed (HTTP ${res.status})`)

  return res.json()
}

/**
 * Every record, paged. 1,510 payments is 8 requests — fine for a dashboard that
 * loads on demand, but do not call this inside a loop over members.
 */
async function getAll<T>(path: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const out: T[] = []
  let page = 1

  while (page <= MAX_PAGES) {
    const { PageInfo, Results } = await getPage<T>(path, params, page)
    out.push(...(Results || []))

    const total = PageInfo?.TotalRecords ?? out.length
    // Guard on an empty page as well as the count: trusting TotalRecords alone
    // spins forever if the API ever reports more than it will hand over.
    if (!Results?.length || out.length >= total) break
    page++
  }

  return out
}

export async function fetchMembers(): Promise<CauseMachineMember[]> {
  return getAll<CauseMachineMember>('v1/members')
}

export async function fetchPayments(): Promise<CauseMachinePayment[]> {
  return getAll<CauseMachinePayment>('v1/payments')
}

export async function fetchRecurringDonations(): Promise<unknown[]> {
  return getAll<unknown>('v1/recurringdonations')
}

/**
 * Events, needed to attribute ticket revenue. Every one-off order carries an
 * EventId but no product name, so without this the largest non-subscription line
 * in the business is an opaque "$13,339 of orders".
 */
export async function fetchEvents(): Promise<CauseMachineEvent[]> {
  return getAll<CauseMachineEvent>('v1/events')
}

/** EventId → event name, for classifying ticket payments. */
export function eventNameMap(events: CauseMachineEvent[]): Map<number, string> {
  const m = new Map<number, string>()
  for (const e of events) {
    if (e.EventId != null && e.Name) m.set(e.EventId, e.Name)
  }
  return m
}

/** Just the totals, one request each — for a connectivity check. */
export async function fetchCounts(): Promise<{ members: number; payments: number; recurring: number }> {
  const [m, p, r] = await Promise.all([
    getPage<unknown>('v1/members', {}, 1),
    getPage<unknown>('v1/payments', {}, 1),
    getPage<unknown>('v1/recurringdonations', {}, 1),
  ])
  return {
    members: m.PageInfo?.TotalRecords ?? 0,
    payments: p.PageInfo?.TotalRecords ?? 0,
    recurring: r.PageInfo?.TotalRecords ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type RevenueMonth = { month: string; gross: number; refunds: number; net: number; fees: number; count: number }

/**
 * Payments summarised by calendar month, newest last.
 *
 * Gross counts only positive amounts and refunds are reported separately, so a
 * month showing £2,000 gross and £300 refunded reads honestly — netting them
 * silently into one figure hides that a refund happened at all.
 *
 * Months are cut in UTC because DateCompleted is a UTC instant. A payment taken
 * late on the last day of the month can therefore land in the next month; that
 * is a known and acceptable edge for a revenue overview.
 */
export function revenueByMonth(payments: CauseMachinePayment[]): RevenueMonth[] {
  const months = new Map<string, RevenueMonth>()

  for (const p of payments) {
    if (p.Status !== 'Completed') continue
    if (!p.DateCompleted) continue
    const month = p.DateCompleted.slice(0, 7)

    const row = months.get(month) || { month, gross: 0, refunds: 0, net: 0, fees: 0, count: 0 }
    if (p.Amount < 0) row.refunds += Math.abs(p.Amount)
    else row.gross += p.Amount
    row.net += p.Amount
    row.fees += p.Fees || 0
    row.count++
    months.set(month, row)
  }

  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export type BusinessMonth = {
  month: string
  /** Net per business, refunds already subtracted. */
  net: Record<Business, number>
  /** Distinct people who paid into each business that month. */
  payers: Record<Business, number>
  total: number
}

const EMPTY_BUSINESS_NET = (): Record<Business, number> =>
  ({ bt: 0, sunrise: 0, unclassified: 0 })

/**
 * Revenue by month, split by business.
 *
 * The payer counts matter as much as the money. A line can fall because prices
 * dropped or because people left, and those are completely different problems —
 * net alone cannot tell them apart, and the first version of this analysis got
 * that wrong. Counting distinct UserIds per month makes it visible.
 *
 * Months are cut in UTC, matching revenueByMonth, because DateCompleted is a UTC
 * instant. See that function for the caveat.
 */
export function revenueByBusiness(
  payments: CauseMachinePayment[],
  events: Map<number, string> = new Map()
): BusinessMonth[] {
  const months = new Map<string, { month: string; net: Record<Business, number>; sets: Record<Business, Set<number>> }>()

  for (const p of payments) {
    if (p.Status !== 'Completed') continue
    if (!p.DateCompleted) continue

    const month = p.DateCompleted.slice(0, 7)
    const business = classify(p.Description, p.EventId ? events.get(p.EventId) ?? null : null)

    const row = months.get(month) || {
      month,
      net: EMPTY_BUSINESS_NET(),
      sets: { bt: new Set<number>(), sunrise: new Set<number>(), unclassified: new Set<number>() },
    }
    row.net[business] += p.Amount
    // A refund on its own should not make someone count as a payer for the month.
    if (p.Amount > 0) row.sets[business].add(p.UserId)
    months.set(month, row)
  }

  return [...months.values()]
    .map(r => ({
      month: r.month,
      net: r.net,
      payers: {
        bt: r.sets.bt.size,
        sunrise: r.sets.sunrise.size,
        unclassified: r.sets.unclassified.size,
      },
      total: r.net.bt + r.net.sunrise + r.net.unclassified,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

export type LineSummary = {
  line: string
  business: Business
  net: number
  payments: number
  people: number
  firstPayment: string | null
  lastPayment: string | null
}

/**
 * Every distinct payment line with its totals, biggest first. This is the view
 * that answers "what are we actually selling" — and the one to re-read whenever
 * the classification in lib/business-lines.ts is being corrected, since anything
 * still marked unclassified shows up here by name.
 */
export function summarizeLines(
  payments: CauseMachinePayment[],
  events: Map<number, string> = new Map()
): LineSummary[] {
  const lines = new Map<string, LineSummary & { users: Set<number> }>()

  for (const p of payments) {
    if (p.Status !== 'Completed') continue

    const eventName = p.EventId ? events.get(p.EventId) ?? null : null
    const key = lineKey(p.Description, eventName)
    const row = lines.get(key) || {
      line: key,
      business: classify(p.Description, eventName),
      net: 0,
      payments: 0,
      people: 0,
      firstPayment: null,
      lastPayment: null,
      users: new Set<number>(),
    }

    row.net += p.Amount
    row.payments++
    row.users.add(p.UserId)
    if (p.DateCompleted) {
      if (!row.firstPayment || p.DateCompleted < row.firstPayment) row.firstPayment = p.DateCompleted
      if (!row.lastPayment || p.DateCompleted > row.lastPayment) row.lastPayment = p.DateCompleted
    }
    lines.set(key, row)
  }

  return [...lines.values()]
    .map(({ users, ...rest }) => ({ ...rest, people: users.size }))
    .sort((a, b) => b.net - a.net)
}

export type MemberSpend = {
  userId: number
  name: string
  email: string | null
  total: number
  payments: number
  firstPayment: string | null
  lastPayment: string | null
}

/** Per-member totals, biggest first. Members with no payments are included at zero. */
export function spendByMember(
  members: CauseMachineMember[],
  payments: CauseMachinePayment[]
): MemberSpend[] {
  const byUser = new Map<number, MemberSpend>()

  for (const m of members) {
    const name = [m.FirstName, m.LastName].filter(Boolean).join(' ').trim()
    byUser.set(m.UserId, {
      userId: m.UserId,
      name: name || m.UserName || `Member ${m.UserId}`,
      email: m.Email,
      total: 0,
      payments: 0,
      firstPayment: null,
      lastPayment: null,
    })
  }

  for (const p of payments) {
    if (p.Status !== 'Completed') continue
    // A payment can reference a UserId with no matching member row — someone
    // removed from Cause Machine keeps their payment history. Counting them
    // under a placeholder keeps the revenue total honest.
    let row = byUser.get(p.UserId)
    if (!row) {
      row = {
        userId: p.UserId,
        name: `Former member ${p.UserId}`,
        email: null,
        total: 0,
        payments: 0,
        firstPayment: null,
        lastPayment: null,
      }
      byUser.set(p.UserId, row)
    }

    row.total += p.Amount
    row.payments++
    if (p.DateCompleted) {
      if (!row.firstPayment || p.DateCompleted < row.firstPayment) row.firstPayment = p.DateCompleted
      if (!row.lastPayment || p.DateCompleted > row.lastPayment) row.lastPayment = p.DateCompleted
    }
  }

  return [...byUser.values()].sort((a, b) => b.total - a.total)
}
