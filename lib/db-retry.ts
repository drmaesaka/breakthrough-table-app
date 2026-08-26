// Retrying a Supabase query that failed for a transient reason.
//
// WHY THIS EXISTS
// The notification jobs guard their first query and return 503 if it fails,
// because a dead database otherwise reads as "nobody to notify" and the cron
// reports a cheerful success through a total outage. That guard is right, but it
// gave up after a single attempt.
//
// Production showed why that matters: roughly one run in twenty failed with
// "JWT issued at future" — Supabase rejecting our own key because the validating
// server's clock was momentarily behind the timestamp baked into it. It clears
// on its own within seconds.
//
// The cost of that is not a logged error, it is a lost window. These jobs match
// the current half-hour slot and never retry a slot, deliberately, because
// re-running one double-notifies everybody. So a blip at 09:00 does not delay
// the 09:00 nudges — it deletes them.
//
// Retrying here keeps the loud failure for a real outage (all attempts fail →
// still 503) while surviving the blip that was costing real notifications.

/** Total attempts, including the first. */
const ATTEMPTS = 3

/** Short and linear: the failure clears in seconds, and the caller is inside a function with a 60s ceiling. */
const BACKOFF_MS = 300

/**
 * Runs a Supabase query, retrying while it returns an error.
 *
 * Generic over the whole result rather than just the row type, so the caller
 * keeps supabase-js's own inference — narrowing it to a hand-written shape
 * erased `data` to `{}` at every call site. The callback returns a PromiseLike
 * because a query builder is a thenable, not a Promise.
 */
export async function retryQuery<R extends { error: { message: string } | null }>(
  label: string,
  run: () => PromiseLike<R>,
  attempts: number = ATTEMPTS
): Promise<R> {
  let last!: R

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, BACKOFF_MS * (attempt - 1)))

    last = await run()
    if (!last.error) return last

    // Logged on every failed attempt rather than only the last, so the pattern
    // is visible: "recovered on attempt 2" and "failed three times" are very
    // different problems and would otherwise look identical in the logs.
    console.warn(`${label}: attempt ${attempt} of ${attempts} failed: ${last.error.message}`)
  }

  return last
}
