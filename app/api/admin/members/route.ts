import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Uses service role key — bypasses RLS for admin operations
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}

export async function GET() {
  const supabase = adminClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, group_id, role, adherence_percent, streak')
    .order('full_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ members: data })
}

export async function PATCH(req: NextRequest) {
  const { userId, groupId, role } = await req.json()
  const supabase = adminClient()

  const updates: any = {}
  if (groupId !== undefined) updates.group_id = groupId || null
  if (role !== undefined) updates.role = role

  const { error } = await supabase.from('profiles').update(updates).eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const { userId } = await req.json()
  const supabase = adminClient()
  const { error } = await supabase.from('profiles').delete().eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
