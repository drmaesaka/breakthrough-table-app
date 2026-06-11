import webpush from 'web-push'

webpush.setVapidDetails(
  'mailto:admin@breakthrough-table.com',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export type PushSubscription = {
  endpoint: string
  p256dh: string
  auth: string
}

export async function sendPush(
  subscription: PushSubscription,
  payload: { title: string; body: string; url?: string }
) {
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
