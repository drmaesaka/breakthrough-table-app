// Resolving member email addresses in bulk, for the notification jobs.
//
// WHY THIS EXISTS
// Push only works inside the installed PWA — on iOS it does not work in Safari
// at all. So every member who has not installed the app to their home screen is
// unreachable by the nudge, check-in and event-notice jobs. Email is the only
// channel that reaches everyone, and reaching people is the entire point of
// those jobs.
//
// WHY NOT auth.admin.getUserById PER MEMBER
// app/api/bookings/route.ts resolves one address that way, which is right for
// one booking. The notification jobs resolve an address for every member on
// every run, and one API call each would turn a 200-member sweep into 200
// sequential round-trips inside a 60-second function. This sweeps the user list
// once instead.
//
// The address itself is not in `profiles` — it lives in Supabase's auth schema,
// which PostgREST does not expose. It has to come through the admin API.

/** Supabase caps this; asking for more silently returns fewer. */
const PER_PAGE = 1000

/** Backstop so a paging bug cannot spin forever inside a serverless function. */
const MAX_PAGES = 50

/**
 * userId → email, for as many of `userIds` as have an address anywhere.
 *
 * Precedence matches `emailFor` in app/api/bookings/route.ts: the account's own
 * auth address first, `profiles.contact_email` only as a fallback. Diverging
 * here would mean booking confirmations and nudges quietly going to different
 * addresses for the same person.
 *
 * A member with no address at all is simply absent from the map. Callers must
 * treat that as "unreachable" rather than assuming a lookup failure — that
 * distinction is why this returns a map rather than throwing.
 */
export async function fetchMemberEmails(
  admin: any,
  userIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (userIds.length === 0) return out

  const wanted = new Set(userIds)

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })

    if (error) {
      // Degrade to contact_email rather than failing the whole run: a nudge
      // reaching some members beats a job that 500s because the auth API
      // hiccupped.
      console.error('fetchMemberEmails: listUsers failed:', error.message)
      break
    }

    const users = data?.users ?? []
    for (const u of users) {
      if (u?.id && u?.email && wanted.has(u.id)) out.set(u.id, u.email)
    }

    // Guard on a short page as well as an empty one, so a final partial page
    // does not cost an extra round-trip.
    if (users.length < PER_PAGE) break
  }

  const missing = userIds.filter(id => !out.has(id))
  if (missing.length > 0) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, contact_email')
      .in('id', missing)

    if (error) {
      console.error('fetchMemberEmails: contact_email lookup failed:', error.message)
    } else {
      for (const p of data ?? []) {
        if (p?.contact_email) out.set(p.id, p.contact_email)
      }
    }
  }

  return out
}
