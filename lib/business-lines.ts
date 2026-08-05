// Which Cause Machine payment lines belong to which business.
//
// Cause Machine holds Breakthrough Table AND Sunrise in one account, so every
// revenue figure has to be split before it means anything. There is nothing in
// the API that marks which is which — no product id, no category, no tag. The
// only signal is the payment Description, so the split lives here as an explicit
// table rather than as a regex buried in an aggregation.
//
// ⚠️ UNCONFIRMED — every assignment below is a guess, sent to Mo 2026-08-05 and
// not yet answered. The two flagged `other` are the least certain: "Collective"
// reads like the coworking space, which may be a third business that is neither.
// Correct this file when she replies; nothing else needs to change.
//
// A line that is not listed here comes back as 'unclassified' and the dashboard
// shows it as its own figure. That is deliberate. If Cause Machine gains a new
// membership tier, the wrong outcome is for its revenue to be silently folded
// into a bucket or silently dropped — either way a number in a meeting is wrong
// and nobody can see why. Unclassified money should be visible and annoying.

export type Business = 'bt' | 'sunrise' | 'other' | 'unclassified'

export const BUSINESS_LABELS: Record<Business, string> = {
  bt: 'Breakthrough Table',
  sunrise: 'Sunrise',
  other: 'Other / workspace',
  unclassified: 'Unclassified',
}

/**
 * Subscription lines, keyed by Description with the "Monthly fee for " prefix
 * stripped. Keys are Cause Machine's own strings, reproduced exactly — including
 * "Collective Workspace Membership Membership", which really does say Membership
 * twice. Do not tidy them; they are matched literally.
 */
export const SUBSCRIPTION_LINES: Record<string, Business> = {
  'Breakthrough Table Mastermind Membership': 'bt',
  'Mastermind - Past Annual Membership': 'bt',
  'Mastermind - Virtual Membership': 'bt',
  'Mastermind - Couples Rate Membership': 'bt',
  'Mastermind - Discount Membership': 'bt',
  'BT Accelerated Membership': 'bt',
  'Sunrise Network Subscription Membership': 'sunrise',
  'Collective Workspace Membership Membership': 'other',
  'Collective Membership': 'other',
}

const SUBSCRIPTION_PREFIX = 'Monthly fee for '

/**
 * One-off orders arrive as "Payment for Order #10174891" and carry no product
 * information at all — the API exposes an OrderNumber but not what was ordered.
 * They are ~$13k across ~370 payments, so they are too big to ignore and too
 * opaque to assign. They stay unclassified until someone says what they are.
 */
export function isOneOffOrder(description: string | null): boolean {
  return /^Payment for Order #/.test((description || '').trim())
}

/**
 * Refunds arrive as negative amounts with a free-text description that names the
 * member and often the reason — "Refund for Sunrise Social registration for
 * <name>: Technical difficulty". Collapsed into one bucket rather than shown as
 * eight separate rows, both because the detail is noise on a revenue breakdown
 * and because a dashboard is the wrong place to publish who was refunded and why.
 */
export function isRefund(description: string | null): boolean {
  return /^Refund for /.test((description || '').trim())
}

/** The subscription line name, or null if this is not a subscription payment. */
export function subscriptionLine(description: string | null): string | null {
  const d = (description || '').trim()
  return d.startsWith(SUBSCRIPTION_PREFIX) ? d.slice(SUBSCRIPTION_PREFIX.length) : null
}

export function classify(description: string | null): Business {
  const line = subscriptionLine(description)
  if (line && SUBSCRIPTION_LINES[line]) return SUBSCRIPTION_LINES[line]
  return 'unclassified'
}

/**
 * Human-readable grouping key. Subscriptions collapse to their line name; every
 * one-off order collapses to a single bucket rather than becoming 370 rows of
 * order numbers nobody can act on.
 */
export function lineKey(description: string | null): string {
  const line = subscriptionLine(description)
  if (line) return line
  if (isOneOffOrder(description)) return 'One-off orders'
  if (isRefund(description)) return 'Refunds'
  return (description || '').trim() || '(no description)'
}
