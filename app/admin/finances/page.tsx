'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import { BUSINESS_LABELS, type Business } from '@/lib/business-lines'

// Read-only financial dashboard over Cause Machine.
//
// Leaders only — enforced server-side by /api/admin/cause-machine, and again on
// this page so a participant who types the URL gets bounced rather than watching
// a spinner over a 403 they cannot see.
//
// Nothing here writes. Cause Machine's API has no write endpoints outside webhook
// management, so a "correction" made here could never reach the source of truth;
// making the page read-only is honesty about that, not caution.

type BusinessMonth = {
  month: string
  net: Record<Business, number>
  payers: Record<Business, number>
  total: number
}

type LineSummary = {
  line: string
  business: Business
  net: number
  payments: number
  people: number
  firstPayment: string | null
  lastPayment: string | null
}

type Summary = {
  counts: { members: number; payments: number; recurring: number }
  businesses: BusinessMonth[]
  lines: LineSummary[]
  totals: {
    net: number
    gross: number
    refunded: number
    fees: number
    payingMembers: number
  }
}

const ORDER: Business[] = ['bt', 'sunrise', 'unclassified']

const BADGE: Record<Business, string> = {
  bt: 'bg-bt-pale text-bt-blue',
  sunrise: 'bg-amber-50 text-amber-700',
  unclassified: 'bg-red-50 text-red-700',
}

const BAR: Record<Business, string> = {
  bt: 'bg-bt-blue',
  sunrise: 'bg-amber-400',
  unclassified: 'bg-red-400',
}

function money(n: number, cents = false) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })
}

function monthLabel(m: string) {
  // Parsed as a UTC instant so the label cannot slip to the previous month for
  // anyone west of UTC — `new Date('2026-03')` is midnight UTC, and rendering it
  // in local time would show February in Chicago.
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
}

export default function FinancesPage() {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (prof?.role !== 'leader') { router.push('/dashboard'); return }

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/cause-machine?view=summary', {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const json = await res.json()

      // A failed read must say so. Rendering zeroes through an outage produces a
      // dashboard that reports the business earned nothing this month.
      if (!res.ok) setError({ message: json?.error || 'Could not load', detail: json?.detail })
      else setData(json)
      setLoading(false)
    }
    load()
  }, [router])

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400 text-sm">Loading from Cause Machine…</p>
    </div>
  )

  const months = data?.businesses ?? []
  // The current month is always partial, so it is shown but never compared
  // against — a month five days in always looks like collapse.
  const complete = months.slice(0, -1)
  const partial = months[months.length - 1]

  const btSeries = complete.map(m => ({ month: m.month, net: m.net.bt, payers: m.payers.bt }))
  const btPeak = btSeries.reduce((a, b) => (b.net > a.net ? b : a), btSeries[0])
  const btLast = btSeries[btSeries.length - 1]
  const btChange = btPeak && btLast && btPeak.net > 0
    ? Math.round(((btLast.net - btPeak.net) / btPeak.net) * 100)
    : 0

  const maxBar = Math.max(1, ...complete.map(m => m.total))
  const unclassified = data?.lines.filter(l => l.business === 'unclassified') ?? []
  const unclassifiedNet = unclassified.reduce((s, l) => s + l.net, 0)

  // Ticket revenue sitting in BT only because the event name gave no signal
  // either way. Computed rather than hardcoded so the banner stays true as
  // events are added — the "Event: " prefix is set by lineKey().
  const ambiguousTicketNet = (data?.lines ?? [])
    .filter(l => l.line.startsWith('Event: ') && l.business === 'bt')
    .reduce((s, l) => s + l.net, 0)

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Finances</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">Live from Cause Machine — read only</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">
        {error && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border-l-4 border-red-400">
            <p className="font-bold text-gray-900">{error.message}</p>
            {error.detail && <p className="text-gray-500 text-sm mt-1">{error.detail}</p>}
            <p className="text-gray-400 text-xs mt-2">
              No figures are shown rather than showing zeroes — a blank dashboard is
              wrong in an obvious way; a dashboard full of zeroes is wrong in a way
              that gets repeated in a meeting.
            </p>
          </div>
        )}

        {data && (
          <>
            {/* Subscriptions are settled. Event tickets are not entirely, and the
                banner names the exact amount still resting on a judgement call
                rather than implying the whole split is shaky. */}
            <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
              <p className="text-amber-900 text-sm font-semibold">
                Memberships confirmed · {money(ambiguousTicketNet)} of event tickets is a judgement call
              </p>
              <p className="text-amber-800/80 text-xs mt-1 leading-relaxed">
                Mo confirmed on 6 Aug 2026 that the Sunrise Network Subscription is the only
                Sunrise membership and every other membership line is Breakthrough Table.
                Event tickets carry no product name, so they are attributed by event: anything
                named for Sunrise counts as Sunrise, and the rest default to Breakthrough
                Table. That default covers {money(ambiguousTicketNet)} across events whose names
                say nothing either way — they are listed individually below.
              </p>
            </div>

            {/* Headline totals — all time */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">All time</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{money(data.totals.net)}</p>
              <p className="text-gray-400 text-xs mt-0.5">
                net of {money(data.totals.refunded, true)} refunded · {money(data.totals.fees)} in fees
              </p>
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-100">
                <div>
                  <p className="text-lg font-bold text-gray-900">{data.counts.members}</p>
                  <p className="text-gray-400 text-xs">members</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{data.totals.payingMembers}</p>
                  <p className="text-gray-400 text-xs">have paid</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{data.counts.payments}</p>
                  <p className="text-gray-400 text-xs">payments</p>
                </div>
              </div>
            </div>

            {/* The number that matters: BT on its own, over time */}
            {btPeak && btLast && (
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="font-bold text-gray-900">Breakthrough Table alone</h2>
                <div className="flex items-baseline gap-2 mt-1">
                  <p className="text-2xl font-bold text-gray-900">{money(btLast.net)}</p>
                  <span className={`text-sm font-semibold ${btChange < 0 ? 'text-red-500' : 'text-green-600'}`}>
                    {btChange > 0 ? '+' : ''}{btChange}% vs peak
                  </span>
                </div>
                <p className="text-gray-400 text-xs mt-0.5">
                  {monthLabel(btLast.month)}: {btLast.payers} paying · peak was{' '}
                  {money(btPeak.net)} from {btPeak.payers} in {monthLabel(btPeak.month)}
                </p>
                {/* Payer count alongside revenue, because the two together say
                    whether a fall is churn or discounting. */}
                <div className="mt-4 space-y-1.5">
                  {btSeries.slice(-12).map(m => (
                    <div key={m.month} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-12 shrink-0">{monthLabel(m.month)}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-bt-blue h-full rounded-full"
                          style={{ width: `${Math.max(1, (m.net / Math.max(1, btPeak.net)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 w-14 text-right shrink-0">{money(m.net)}</span>
                      <span className="text-[10px] text-gray-400 w-10 text-right shrink-0">{m.payers}p</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Every business, stacked, so the shape of the whole is visible */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="font-bold text-gray-900">By business, by month</h2>
              <p className="text-gray-400 text-xs mt-0.5 mb-4">Last 12 complete months</p>
              <div className="space-y-2">
                {complete.slice(-12).map(m => (
                  <div key={m.month}>
                    <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{monthLabel(m.month)}</span>
                      <span>{money(m.total)}</span>
                    </div>
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
                      {ORDER.map(b => m.net[b] > 0 && (
                        <div
                          key={b}
                          className={BAR[b]}
                          style={{ width: `${(m.net[b] / maxBar) * 100}%` }}
                          title={`${BUSINESS_LABELS[b]}: ${money(m.net[b])}`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-gray-100">
                {ORDER.map(b => (
                  <div key={b} className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-sm ${BAR[b]}`} />
                    <span className="text-xs text-gray-500">{BUSINESS_LABELS[b]}</span>
                  </div>
                ))}
              </div>
              {partial && (
                <p className="text-gray-400 text-xs mt-3">
                  {monthLabel(partial.month)} is still in progress ({money(partial.total)} so far) and is
                  left out of the chart above.
                </p>
              )}
            </div>

            {/* Unclassified money, called out rather than buried */}
            {unclassifiedNet > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-5 border-l-4 border-red-400">
                <h2 className="font-bold text-gray-900">{money(unclassifiedNet)} unclassified</h2>
                <p className="text-gray-500 text-sm mt-1 leading-relaxed">
                  {unclassified.reduce((s, l) => s + l.payments, 0)} payments whose description does
                  not say what was bought. They are counted in the all-time total but belong to no
                  business until someone says which.
                </p>
              </div>
            )}

            {/* The workings */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="font-bold text-gray-900">Every payment line</h2>
              <p className="text-gray-400 text-xs mt-0.5 mb-4">
                What the split above is built from
              </p>
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs">
                      <th className="text-left font-medium pb-2">Line</th>
                      <th className="text-right font-medium pb-2">Net</th>
                      <th className="text-right font-medium pb-2">People</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map(l => (
                      <tr key={l.line} className="border-t border-gray-100">
                        <td className="py-2 pr-3">
                          <p className="text-gray-900 leading-tight">{l.line}</p>
                          <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mt-1 ${BADGE[l.business]}`}>
                            {BUSINESS_LABELS[l.business]}
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-900 whitespace-nowrap align-top">{money(l.net)}</td>
                        <td className="py-2 text-right text-gray-500 align-top">{l.people}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
