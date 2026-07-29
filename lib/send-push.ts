import webpush from 'web-push'

export type PushSubscription = {
  endpoint: string
  p256dh: string
  auth: string
}

// web-push 3.6.7 (the current release) still calls Node's `url.parse()`, and the
// resulting DEP0169 warning is written to stderr — which Vercel classifies as
// `error` level. The effect is that every *healthy* nudge run shows up in the
// logs as an error, so a real failure is indistinguishable from routine traffic.
// Suppress that one warning code and nothing else.
let deprecationFilterInstalled = false
function silenceUrlParseDeprecation() {
  if (deprecationFilterInstalled) return
  deprecationFilterInstalled = true

  const originalEmit = process.emit
  // @ts-expect-error — replacing an overloaded signature
  process.emit = function (name: string, data: unknown, ...rest: unknown[]) {
    if (
      name === 'warning' &&
      typeof data === 'object' && data !== null &&
      (data as { name?: string }).name === 'DeprecationWarning' &&
      (data as { code?: string }).code === 'DEP0169'
    ) {
      return false
    }
    // @ts-expect-error — forwarding the original overloaded call
    return originalEmit.call(process, name, data, ...rest)
  }
}

export async function sendPush(
  subscription: PushSubscription,
  payload: { title: string; body: string; url?: string }
) {
  silenceUrlParseDeprecation()

  // Set at call time so env vars are available at runtime not build time
  webpush.setVapidDetails(
    'mailto:admin@breakthrough-table.com',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload)
    )
    return true
  } catch (err: any) {
    // 410 Gone = subscription expired/revoked, caller should delete it
    if (err.statusCode === 410) return 'expired'
    console.error('Push error:', err.message)
    return false
  }
}
