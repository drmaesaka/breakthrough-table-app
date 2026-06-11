'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function JournalPage() {
  const [prompts, setPrompts] = useState<any[]>([])
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [savedResponses, setSavedResponses] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null)
  const [groupResponses, setGroupResponses] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const [groupName, setGroupName] = useState('')
  const router = useRouter()

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    setUserId(user.id)

    const { data: prof } = await supabase
      .from('profiles')
      .select('group_id, groups(name)')
      .eq('id', user.id)
      .single()

    if (!prof?.group_id) { setLoading(false); return }
    setGroupName((prof.groups as any)?.name || '')

    const [{ data: promptData }, { data: myResponses }] = await Promise.all([
      supabase.from('journal_prompts')
        .select('*')
        .eq('group_id', prof.group_id)
        .order('created_at', { ascending: false }),
      supabase.from('journal_responses')
        .select('prompt_id, response')
        .eq('user_id', user.id),
    ])

    setPrompts(promptData || [])

    const myRespMap: Record<string, string> = {}
    ;(myResponses || []).forEach((r: any) => { myRespMap[r.prompt_id] = r.response })
    setResponses(myRespMap)
    setSavedResponses(myRespMap)

    // Auto-expand the most recent unanswered prompt
    const unanswered = (promptData || []).find(p => !myRespMap[p.id])
    if (unanswered) setExpandedPrompt(unanswered.id)
    else if (promptData && promptData.length > 0) setExpandedPrompt(promptData[0].id)

    setLoading(false)
  }

  async function saveResponse(promptId: string) {
    const text = responses[promptId]?.trim()
    if (!text) return
    setSaving(s => ({ ...s, [promptId]: true }))
    const supabase = createClient()

    await supabase.from('journal_responses').upsert({
      prompt_id: promptId,
      user_id: userId,
      response: text,
    }, { onConflict: 'prompt_id,user_id' })

    setSavedResponses(s => ({ ...s, [promptId]: text }))
    setSaving(s => ({ ...s, [promptId]: false }))
    setSaved(s => ({ ...s, [promptId]: true }))
    setTimeout(() => setSaved(s => ({ ...s, [promptId]: false })), 2500)
  }

  async function loadGroupResponses(promptId: string) {
    if (groupResponses[promptId]) return // already loaded
    const supabase = createClient()
    const { data } = await supabase
      .from('journal_responses')
      .select('response, user_id, profiles(full_name)')
      .eq('prompt_id', promptId)
    setGroupResponses(r => ({ ...r, [promptId]: data || [] }))
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Reflection Prompts</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">{groupName} · Think before the table</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">
        {prompts.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">🪞</p>
            <p className="text-gray-500 font-medium">No prompts yet</p>
            <p className="text-gray-400 text-sm mt-1">Your leader will post reflection questions here</p>
          </div>
        )}

        {prompts.map((prompt, i) => {
          const isExpanded = expandedPrompt === prompt.id
          const myResponse = savedResponses[prompt.id]
          const isAnswered = !!myResponse
          const isLatest = i === 0

          return (
            <div key={prompt.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {/* Prompt header */}
              <button
                onClick={() => {
                  setExpandedPrompt(isExpanded ? null : prompt.id)
                  if (!isExpanded) loadGroupResponses(prompt.id)
                }}
                className="w-full px-5 py-4 text-left flex items-start gap-3">
                <div className={`mt-0.5 w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${
                  isAnswered ? 'bg-bt-navy' : 'border-2 border-gray-200'
                }`}>
                  {isAnswered && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {isLatest && <span className="text-xs bg-bt-blue text-white px-2 py-0.5 rounded-full font-semibold">Latest</span>}
                    <span className="text-xs text-gray-400">{formatDate(prompt.created_at)}</span>
                  </div>
                  <p className={`text-sm font-semibold leading-snug ${isExpanded ? 'text-bt-navy' : 'text-gray-700'}`}>
                    {prompt.prompt}
                  </p>
                </div>
                <svg className={`w-4 h-4 text-gray-300 flex-shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 space-y-4 border-t border-gray-50 pt-4">
                  {/* My response */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Your reflection</p>
                    <textarea
                      value={responses[prompt.id] || ''}
                      onChange={e => setResponses(r => ({ ...r, [prompt.id]: e.target.value }))}
                      placeholder="Write your thoughts here... This is just for you and your table."
                      rows={4}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue resize-none leading-relaxed"
                    />
                    <button
                      onClick={() => saveResponse(prompt.id)}
                      disabled={saving[prompt.id] || !responses[prompt.id]?.trim() || responses[prompt.id]?.trim() === savedResponses[prompt.id]}
                      className="mt-2 w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
                      {saving[prompt.id] ? 'Saving...' : saved[prompt.id] ? '✓ Saved!' : isAnswered ? 'Update Response' : 'Save Response'}
                    </button>
                  </div>

                  {/* Table responses */}
                  {groupResponses[prompt.id] && groupResponses[prompt.id].length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        From the table ({groupResponses[prompt.id].length})
                      </p>
                      <div className="space-y-3">
                        {groupResponses[prompt.id].map((r: any) => {
                          const name = (r.profiles as any)?.full_name || 'Member'
                          const parts = name.trim().split(' ')
                          const initials = parts.length >= 2 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase()
                          const isMe = r.user_id === userId
                          return (
                            <div key={r.user_id} className={`rounded-xl p-3 ${isMe ? 'bg-bt-pale border border-bt-blue/20' : 'bg-gray-50'}`}>
                              <div className="flex items-center gap-2 mb-1.5">
                                <div className="w-6 h-6 rounded-full bg-bt-navy flex items-center justify-center flex-shrink-0">
                                  <span className="text-white text-xs font-bold">{initials}</span>
                                </div>
                                <span className="text-xs font-semibold text-gray-600">{isMe ? 'You' : name}</span>
                              </div>
                              <p className="text-sm text-gray-700 leading-relaxed">{r.response}</p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <BottomNav />
    </div>
  )
}
