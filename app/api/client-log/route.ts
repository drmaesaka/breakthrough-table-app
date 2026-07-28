// Receives failed-write reports beaconed from lib/supabase.ts and echoes them
// to stderr so they show up in Vercel's function logs. No storage, no auth:
// the payload is capped and nothing is done with it beyond logging.
export async function POST(request: Request) {
  let text = ''
  try {
    text = (await request.text()).slice(0, 2000)
  } catch {
    text = '(unreadable body)'
  }
  console.error('[client-write-failure]', text)
  return new Response(null, { status: 204 })
}
