import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireLeader } from '@/lib/api-auth'
import { isOwnChatPhoto } from '@/lib/chat-photo'

// Sending in the TC Room (2026-10-29). Server-side so a console policy on
// leader_messages cannot block a TC's message; TCs only.
export async function POST(req: NextRequest) {
  const auth = await requireLeader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { content, image_url } = await req.json().catch(() => ({}))
  const text = typeof content === 'string' ? content.trim() : ''
  const photo = isOwnChatPhoto(image_url, auth.userId) ? image_url : null
  if (image_url && !photo) return NextResponse.json({ error: 'Bad photo' }, { status: 400 })
  if (!text && !photo) return NextResponse.json({ error: 'Write a message' }, { status: 400 })
  const { data, error } = await adminClient().from('leader_messages')
    .insert({ user_id: auth.userId, content: text, ...(photo ? { image_url: photo } : {}) })
    .select('id').single()
  if (error) return NextResponse.json({ error: 'Could not send' }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
