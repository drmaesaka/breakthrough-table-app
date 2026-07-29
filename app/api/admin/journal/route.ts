import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader, requireGroupOwnership } from '@/lib/api-auth'

// Every prompt for the group with every member's response attached. Runs with
// the service key because a leader is not necessarily *in* the group they lead:
// the journal RLS policies are written for members, so the leader's own browser
// may legitimately see zero responses.
export async function GET(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const groupId = url.searchParams.get('group_id')
  if (!groupId) return NextResponse.json({ error: 'group_id is required' }, { status: 400 })

  const owns = await requireGroupOwnership(auth.userId, groupId)
  if (!owns.ok) return NextResponse.json({ error: owns.error }, { status: owns.status })

  const supabase = adminClient()

  const { data: prompts, error: promptsError } = await supabase
    .from('journal_prompts')
    .select('id, prompt, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })

  if (promptsError) {
    return NextResponse.json({ error: 'Could not load prompts' }, { status: 500 })
  }
  if (!prompts || prompts.length === 0) return NextResponse.json({ prompts: [] })

  const { data: responses, error: responsesError } = await supabase
    .from('journal_responses')
    .select('prompt_id, response, user_id, profiles(full_name)')
    .in('prompt_id', prompts.map(p => p.id))

  if (responsesError) {
    return NextResponse.json({ error: 'Could not load responses' }, { status: 500 })
  }

  const byPrompt = new Map<string, any[]>()
  for (const r of responses || []) {
    byPrompt.set(r.prompt_id, [...(byPrompt.get(r.prompt_id) || []), {
      name: (r.profiles as any)?.full_name || r.user_id,
      response: r.response,
    }])
  }

  return NextResponse.json({
    prompts: prompts.map(p => ({
      id: p.id,
      prompt: p.prompt,
      created_at: p.created_at,
      responses: byPrompt.get(p.id) || [],
    })),
  })
}
