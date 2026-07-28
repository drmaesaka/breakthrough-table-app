import { createBrowserClient } from '@supabase/ssr'

// supabase-js returns errors instead of throwing, and most call sites in this
// app discard the result — so a write rejected by RLS looks identical to a
// success. Intercepting fetch catches every failed REST write at one choke
// point instead of relying on each call site to check `error`.
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const MAX_REPORTS_PER_PAGE = 10
let reportsSent = 0

function reportWriteFailure(method: string, table: string, status: number, body: string) {
  console.error(`[supabase] ${method} ${table} failed (${status}): ${body}`)
  if (reportsSent >= MAX_REPORTS_PER_PAGE) return
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return
  reportsSent++
  try {
    // Beacon to our own API so the failure lands in Vercel's function logs,
    // not just the member's browser console where nobody will ever see it.
    navigator.sendBeacon(
      '/api/client-log',
      JSON.stringify({ method, table, status, body, page: window.location.pathname })
    )
  } catch {
    // reporting must never break the app
  }
}

async function loggingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
  if (!res.ok && WRITE_METHODS.has(method)) {
    const rawUrl = input instanceof Request ? input.url : String(input)
    const restIndex = rawUrl.indexOf('/rest/v1/')
    if (restIndex !== -1) {
      const table = rawUrl.slice(restIndex + '/rest/v1/'.length).split('?')[0]
      let body = ''
      try {
        body = (await res.clone().text()).slice(0, 500)
      } catch {
        // body unavailable; status alone is still worth reporting
      }
      reportWriteFailure(method, table, res.status, body)
    }
  }
  return res
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: loggingFetch } }
  )
}
