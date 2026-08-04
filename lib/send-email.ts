// Transactional email, via Resend's REST API.
//
// SHIPS DORMANT ON PURPOSE. Resend cannot send for breakthroughtable.com until
// three DNS records are added at GoDaddy, which is waiting on someone else. So
// this module checks whether it is configured and, when it is not, logs what it
// *would* have sent and reports success to the caller.
//
// The alternative — wiring the confirmation email in later — means shipping a
// booking flow now and editing it again under launch pressure. This way the
// call sites are already correct and the feature turns on with two environment
// variables and no deploy of new logic.
//
// Configured means BOTH of:
//   RESEND_API_KEY  — from the Resend account that owns the verified domain
//   RESEND_FROM     — e.g. 'Breakthrough Table <noreply@send.breakthroughtable.com>'
//
// RESEND_FROM is deliberately part of the gate rather than defaulted. There is
// already a RESEND_API_KEY in .env.local belonging to a different Resend account
// with zero verified domains; defaulting the sender would make this module look
// configured and fail on every send.
//
// Deliberately no `resend` npm package: one fetch call is the whole client, and
// package.json carries a hand-tuned `overrides` block that npm keeps trying to
// "fix". Fewer installs, fewer chances for that to happen.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export type EmailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: 'not_configured' }
  | { sent: false; reason: 'failed'; detail: string }

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM)
}

export async function sendEmail(msg: {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
}): Promise<EmailResult> {
  if (!emailConfigured()) {
    // Logged at info, not error: an unconfigured sender is the expected state
    // right now, and routing it to stderr would make every healthy booking look
    // like a failure in the Vercel logs — the exact problem send-push.ts had.
    console.log(
      `email (dormant, would send): to=${msg.to} subject=${JSON.stringify(msg.subject)}`
    )
    return { sent: false, reason: 'not_configured' }
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => `HTTP ${res.status}`)
      console.error('email send failed:', res.status, detail)
      return { sent: false, reason: 'failed', detail }
    }

    const body = await res.json().catch(() => ({}))
    return { sent: true, id: body?.id ?? null }
  } catch (err: any) {
    console.error('email send threw:', err?.message)
    return { sent: false, reason: 'failed', detail: err?.message || 'unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Booking notices
// ---------------------------------------------------------------------------

export type BookingEmailDetails = {
  memberName: string
  roomName: string
  suite: string
  /** Already formatted for a human, e.g. 'Wed, Aug 5'. */
  dateLabel: string
  /** e.g. '9:00 AM – 10:30 AM'. */
  timeLabel: string
  notes?: string | null
}

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || 'https://breakthrough-table-app.vercel.app'

export function bookingConfirmationEmail(d: BookingEmailDetails) {
  const lines = [
    `Hi ${d.memberName},`,
    '',
    'Your room is booked.',
    '',
    `  ${d.roomName} · ${d.suite}`,
    `  ${d.dateLabel}`,
    `  ${d.timeLabel}`,
    ...(d.notes ? ['', `  Notes: ${d.notes}`] : []),
    '',
    `Need to change it? Cancel or rebook at ${APP_URL()}/booking`,
    '',
    '— Breakthrough Table',
  ]
  return { subject: `Room booked: ${d.roomName}, ${d.dateLabel}`, text: lines.join('\n') }
}

export function bookingCancellationEmail(d: BookingEmailDetails) {
  const lines = [
    `Hi ${d.memberName},`,
    '',
    'This booking has been cancelled:',
    '',
    `  ${d.roomName} · ${d.suite}`,
    `  ${d.dateLabel}`,
    `  ${d.timeLabel}`,
    '',
    `The room is open again — book another time at ${APP_URL()}/booking`,
    '',
    '— Breakthrough Table',
  ]
  return { subject: `Booking cancelled: ${d.roomName}, ${d.dateLabel}`, text: lines.join('\n') }
}
