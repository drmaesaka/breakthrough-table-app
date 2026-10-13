import { createClient } from '@/lib/supabase'

/**
 * Emails one member the "add the app to your Home Screen and allow
 * notifications" steps with the app link (/api/admin/push-reminder). For a
 * TC's per-member button (2026-10-13); Admin → Members also has an
 * everyone-without-notifications version.
 */
export async function sendSetupLink(userId: string, name: string): Promise<string> {
  if (!confirm(`Email ${name} the app link and the steps to add it to their Home Screen?`)) return ''
  const { data: { session } } = await createClient().auth.getSession()
  const res = await fetch('/api/admin/push-reminder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ user_ids: [userId] }),
  }).catch(() => null)
  const r = res ? await res.json().catch(() => ({})) : {}
  if (!res?.ok) return r.error || 'Could not send. Try again.'
  if (r.emailed) return `✓ Sent to ${name}.`
  if (r.unreachable?.length) return `No email address on file for ${name}.`
  return `${name} already has the app set up with notifications on.`
}
