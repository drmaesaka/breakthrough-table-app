const PAGE_SIZE = 1000

type Page<T> = { data: T[] | null; error: { message: string } | null }

/**
 * Reads every row of a query instead of the first page.
 *
 * PostgREST caps an unbounded select at 1000 rows and returns the truncated set
 * with **no error**, so any table that grows past that quietly starts answering
 * with part of itself. That is how `task_completions` was set up to corrupt
 * adherence: the nudge cron recomputes every member's percentage from a full
 * scan of that table, and the day it crosses 1000 rows the missing completions
 * read as work nobody did.
 *
 * Pass a builder that applies `.range(from, to)` to the query; it is called
 * once per page until a short page comes back.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<Page<T>>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) return { data: out, error }

    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }

  return { data: out, error: null }
}
