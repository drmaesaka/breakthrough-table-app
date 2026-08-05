import { NextRequest, NextResponse } from 'next/server'
import { requireLeader } from '@/lib/api-auth'
import {
  causeMachineConfigured,
  fetchCounts,
  fetchMembers,
  fetchPayments,
  revenueByBusiness,
  revenueByMonth,
  spendByMember,
  summarizeLines,
} from '@/lib/cause-machine'

// Read-only window onto Cause Machine's membership and payment records.
//
// Leaders only, and server-side without exception: the credentials unlock the
// whole membership database including every email address, so they must never
// reach a browser. This route is the only thing the client is allowed to talk
// to, and it returns figures rather than raw records.
//
// ?view=summary (default) — counts and revenue by month. No personal data at
//                           all, so it is safe to load on a dashboard.
// ?view=members           — per-member spend. Contains names and emails, so it
//                           is a deliberate second request, not part of summary.

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!causeMachineConfigured()) {
    return NextResponse.json(
      {
        error: 'Cause Machine is not connected',
        detail:
          'CAUSE_MACHINE_APP_ID and CAUSE_MACHINE_KEY are not set on this deployment. ' +
          'Generate them in Cause Machine under Settings → Integrations → API.',
      },
      { status: 503 }
    )
  }

  const view = new URL(req.url).searchParams.get('view') || 'summary'

  try {
    if (view === 'members') {
      // Both are needed: members alone has no money, payments alone has no names.
      const [members, payments] = await Promise.all([fetchMembers(), fetchPayments()])
      return NextResponse.json({ members: spendByMember(members, payments) })
    }

    const [counts, payments] = await Promise.all([fetchCounts(), fetchPayments()])
    const months = revenueByMonth(payments)
    const completed = payments.filter(p => p.Status === 'Completed')

    return NextResponse.json({
      counts,
      months,
      // Split by business, plus the line-by-line breakdown the split is derived
      // from. Both are sent so the dashboard can show its own workings — the
      // classification is an unconfirmed guess (see lib/business-lines.ts) and a
      // figure nobody can audit is worse than no figure.
      businesses: revenueByBusiness(payments),
      lines: summarizeLines(payments),
      totals: {
        // Netted, so refunds reduce it. A "total revenue" that ignores refunds
        // is the kind of number that gets repeated in a meeting and is wrong.
        net: completed.reduce((s, p) => s + p.Amount, 0),
        gross: completed.filter(p => p.Amount > 0).reduce((s, p) => s + p.Amount, 0),
        refunded: completed.filter(p => p.Amount < 0).reduce((s, p) => s + Math.abs(p.Amount), 0),
        fees: completed.reduce((s, p) => s + (p.Fees || 0), 0),
        payingMembers: new Set(completed.map(p => p.UserId)).size,
      },
    })
  } catch (err: any) {
    // The message is ours, never the upstream body — a failed auth response can
    // echo back the credentials that were sent.
    console.error('cause machine read failed:', err?.message)
    return NextResponse.json(
      { error: 'Could not read from Cause Machine', detail: err?.message || 'unknown error' },
      { status: 502 }
    )
  }
}
