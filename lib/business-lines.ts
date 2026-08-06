// Which Cause Machine payment lines belong to which business.
//
// Cause Machine holds Breakthrough Table AND Sunrise in one account, so every
// revenue figure has to be split before it means anything.
//
// CONFIRMED BY MO 2026-08-06, for subscriptions: "Sunrise Network Subscription
// is Sunrise only and then all the others are Breakthrough Table." That is the
// whole rule for the recurring lines and it is not a guess any more.
//
// Her answer for the one-off orders was "event tickets and a few BT journals",
// and that one does NOT survive contact with the data — see EVENT_TICKETS below.
//
// A line that is not listed here comes back as 'unclassified' and the dashboard
// shows it as its own figure. That is deliberate. If Cause Machine gains a new
// membership tier, the wrong outcome is for its revenue to be silently folded
// into a bucket or silently dropped — either way a number in a meeting is wrong
// and nobody can see why. Unclassified money should be visible and annoying.

export type Business = 'bt' | 'sunrise' | 'unclassified'

export const BUSINESS_LABELS: Record<Business, string> = {
  bt: 'Breakthrough Table',
  sunrise: 'Sunrise',
  unclassified: 'Unclassified',
}

/**
 * Subscription lines, keyed by Description with the "Monthly fee for " prefix
 * stripped. Keys are Cause Machine's own strings, reproduced exactly — including
 * "Collective Workspace Membership Membership", which really does say Membership
 * twice. Do not tidy them; they are matched literally.
 *
 * The many Mastermind rows are one product at different price points, which is
 * why there are so many. Mo wants them collapsed to three membership types in
 * Cause Machine itself (BT Member, SN Subscriber, Coworking) — that is a cleanup
 * in her system, not here, and this table keeps working either way.
 */
export const SUBSCRIPTION_LINES: Record<string, Business> = {
  'Breakthrough Table Mastermind Membership': 'bt',
  'Mastermind - Past Annual Membership': 'bt',
  'Mastermind - Virtual Membership': 'bt',
  'Mastermind - Couples Rate Membership': 'bt',
  'Mastermind - Discount Membership': 'bt',
  'BT Accelerated Membership': 'bt',
  // Coworking. Mo's "all the others are Breakthrough Table" puts these on the BT
  // side of the split even though she thinks of coworking as its own membership
  // type. The line breakdown still shows them separately, so the distinction is
  // not lost — it just is not a third business.
  'Collective Workspace Membership Membership': 'bt',
  'Collective Membership': 'bt',
  'Sunrise Network Subscription Membership': 'sunrise',
}

const SUBSCRIPTION_PREFIX = 'Monthly fee for '

/**
 * EVENT TICKETS — where Mo's answer and the data disagree.
 *
 * She said the one-off orders were BT event tickets plus some BT journals. Every
 * one of the 365 of them carries an EventId, and resolving those against
 * v1/events gives the real names. $10,822 of the $13,339 is explicitly Sunrise:
 *
 *     $6,150.00  Sunrise Social - April 9, 2026
 *     $4,502.50  Sunrise Social - October 30, 2025
 *       $110.00  Sunrise Network Happy Hour
 *        $60.00  Sunrise Network MemberGuest Networking
 *
 * So event tickets are not a BT line. They are mostly Sunrise, and calling them
 * all BT would have moved about $10.8k onto the wrong side of the split.
 *
 * No journals appear anywhere in the payment data — every one-off order is tied
 * to an event, so whatever happened to the journal sales, they are not here.
 *
 * The remaining ~$2.5k is workshops and socials whose names say nothing either
 * way ("Pickleball Social", "Work That Fits", the Leadership Webinar Series).
 * Those follow Mo's stated rule and land in BT, and every one of them is listed
 * by name in the dashboard's line breakdown so a wrong call is visible and is a
 * one-line fix here rather than an invisible error in a total.
 *
 * NOTE: OrganizationName on the event record is useless as a discriminator — all
 * 80 events, and 181 of 221 member records, say "Sunrise Network", because the
 * Cause Machine account itself is registered to that organisation. The event
 * NAME is the only real signal.
 */
const SUNRISE_EVENT_PATTERN = /sunrise/i

/** Events explicitly named for the other business, overriding the BT default. */
export function classifyEvent(eventName: string | null): Business {
  const n = (eventName || '').trim()
  if (!n) return 'unclassified'
  return SUNRISE_EVENT_PATTERN.test(n) ? 'sunrise' : 'bt'
}

/**
 * One-off orders arrive as "Payment for Order #10174891" and carry no product
 * information in the description — but they do carry an EventId, which resolves
 * to a name. Kept as a predicate because an order whose event cannot be resolved
 * must not silently become BT.
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

/**
 * `eventName` is the resolved name for the payment's EventId, or null. It takes
 * priority over the description, because for a ticket the description says only
 * "Payment for Order #…" while the event name says what was actually sold.
 */
export function classify(description: string | null, eventName: string | null = null): Business {
  if (eventName) return classifyEvent(eventName)

  const line = subscriptionLine(description)
  if (line && SUBSCRIPTION_LINES[line]) return SUBSCRIPTION_LINES[line]

  // A refund inherits nothing, and an order we could not resolve to an event is
  // exactly the case that must stay visible rather than defaulting to BT.
  return 'unclassified'
}

/**
 * Human-readable grouping key. Subscriptions collapse to their line name and
 * tickets to their event name — so the breakdown reads as a list of things that
 * were actually sold, rather than 365 order numbers nobody can act on.
 */
export function lineKey(description: string | null, eventName: string | null = null): string {
  if (eventName) return `Event: ${eventName}`
  const line = subscriptionLine(description)
  if (line) return line
  if (isRefund(description)) return 'Refunds'
  if (isOneOffOrder(description)) return 'Orders with no resolvable event'
  return (description || '').trim() || '(no description)'
}
