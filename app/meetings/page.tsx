'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import {
  MEETING_PLANS,
  MEETING_SECTIONS,
  resolveMeetingPlans,
  type StoredMeetingPlan,
} from '@/lib/meeting-plans'

// The meeting outline as it is read during the meeting itself: one meeting on
// screen, sections in order, type large enough to follow from across a table.
// Editing lives in the admin panel — a TC running a meeting should not be one
// stray tap away from rewriting the curriculum.

export default function MeetingsPage() {
  const [plans, setPlans] = useState<StoredMeetingPlan[]>([])
  const [current, setCurrent] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('group_id, groups(current_meeting_number)')
        .eq('id', user.id)
        .maybeSingle()

      const { data: rows, error } = await supabase
        .from('meeting_plans')
        .select('*')
        .order('number', { ascending: true })

      // Before the migration and seed have run there is nothing to read. Fall
      // back to the bundled curriculum so the page is useful on day one rather
      // than showing an empty shelf and looking broken.
      if (error) console.error('meeting plans fetch failed:', error.message)
      const resolved = rows && rows.length
        ? resolveMeetingPlans(rows as StoredMeetingPlan[])
        : (MEETING_PLANS as StoredMeetingPlan[])

      const group = Array.isArray(profile?.groups) ? profile?.groups[0] : profile?.groups
      const currentNumber = (group as any)?.current_meeting_number ?? null

      setPlans(resolved)
      setCurrent(currentNumber)
      setSelected(
        currentNumber !== null && resolved.some(p => p.number === currentNumber)
          ? currentNumber
          : null
      )
      setLoading(false)
    }
    load()
  }, [router])

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  const plan = plans.find(p => p.number === selected) || null
  const index = plan ? plans.findIndex(p => p.number === plan.number) : -1
  const prev = index > 0 ? plans[index - 1] : null
  const next = index >= 0 && index < plans.length - 1 ? plans[index + 1] : null

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Meetings</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">
          {plan ? `Meeting #${plan.number} — ${plan.title}` : 'The outline for every BT table meeting'}
        </p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">
        {!plan ? (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-bt-navy mb-1">All Meetings</h3>
            <p className="text-xs text-gray-400 mb-4">Tap a meeting to open its outline.</p>
            <div className="space-y-2">
              {plans.map(m => (
                <button key={m.number} onClick={() => setSelected(m.number)}
                  className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-bt-pale hover:bg-bt-light/30 transition-colors text-left">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-bt-blue uppercase tracking-wider">
                        Meeting #{m.number}
                      </span>
                      {m.number === current && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900 text-sm mt-0.5">{m.title}</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <button onClick={() => setSelected(null)}
              className="flex items-center gap-2 text-sm font-medium text-bt-blue">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              All Meetings
            </button>

            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold text-bt-blue uppercase tracking-wider">
                  Meeting #{plan.number}
                </p>
                {plan.group_id && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-bt-pale text-bt-navy px-2 py-0.5 rounded-full">
                    Your table&apos;s version
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-bold text-bt-navy mt-1 leading-tight">{plan.title}</h2>
            </div>

            {MEETING_SECTIONS.map(section => {
              const items = plan[section.key] || []
              if (items.length === 0) return null
              return (
                <div key={section.key} className="bg-white rounded-2xl p-5 shadow-sm">
                  <h4 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
                    <span className="text-lg">{section.icon}</span> {section.label}
                  </h4>
                  <ul className="space-y-2.5">
                    {items.map((item, i) => (
                      <li key={i} className="text-[15px] text-gray-700 flex gap-2.5 leading-relaxed">
                        <span className="text-gray-300 flex-shrink-0 mt-0.5">•</span>
                        <span>{linkify(item)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}

            <div className="flex gap-3">
              {prev && (
                <button onClick={() => { setSelected(prev.number); window.scrollTo(0, 0) }}
                  className="flex-1 bg-white border border-gray-200 text-bt-navy py-3 rounded-xl font-semibold text-sm">
                  ← Meeting #{prev.number}
                </button>
              )}
              {next && (
                <button onClick={() => { setSelected(next.number); window.scrollTo(0, 0) }}
                  className="flex-1 bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm">
                  Meeting #{next.number} →
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  )
}

/** Bullets sometimes carry a trailing URL; render it as a link, not raw text. */
function linkify(text: string) {
  if (!text.includes('https://')) return text
  const [before, ...rest] = text.split('https://')
  return (
    <>
      {before.replace(/:\s*$/, '')}{' '}
      <a href={'https://' + rest.join('https://')} target="_blank" rel="noopener noreferrer"
        className="text-bt-blue underline break-all">link</a>
    </>
  )
}
