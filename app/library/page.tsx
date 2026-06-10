'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

const TYPE_ICONS: Record<string, string> = {
  video: '🎥',
  pdf: '📄',
  article: '📰',
  link: '🔗',
}

export default function LibraryPage() {
  const [current, setCurrent] = useState<any[]>([])
  const [previous, setPrevious] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showPrevious, setShowPrevious] = useState(false)
  const [groupName, setGroupName] = useState('')
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase
        .from('profiles')
        .select('group_id, groups(name)')
        .eq('id', user.id)
        .single()

      if (!prof?.group_id) { setLoading(false); return }
      setGroupName((prof.groups as any)?.name || '')

      // Get all content for group, newest first
      const { data: contentData } = await supabase
        .from('content')
        .select('*')
        .eq('group_id', prof.group_id)
        .order('created_at', { ascending: false })

      if (!contentData || contentData.length === 0) { setLoading(false); return }

      // Most recently added item(s) in the same period = current
      // We group by period_label if present, otherwise just take the newest batch (same day or newest)
      // Simple rule: items added within 7 days of the newest item = current
      const newestDate = new Date(contentData[0].created_at)
      const cutoff = new Date(newestDate)
      cutoff.setDate(cutoff.getDate() - 7)

      const curr = contentData.filter(item => new Date(item.created_at) >= cutoff)
      const prev = contentData.filter(item => new Date(item.created_at) < cutoff)

      setCurrent(curr)
      setPrevious(prev)
      setLoading(false)
    }
    load()
  }, [router])

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function ContentCard({ item }: { item: any }) {
    return (
      <a href={item.url} target="_blank" rel="noopener noreferrer"
        className="block bg-white rounded-2xl p-4 shadow-sm active:opacity-70 transition-opacity">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-bt-pale flex items-center justify-center flex-shrink-0 text-lg">
            {TYPE_ICONS[item.type] || '🔗'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm leading-snug">{item.title}</p>
            {item.description && (
              <p className="text-gray-400 text-xs mt-1 leading-relaxed line-clamp-2">{item.description}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-400 capitalize">{item.type}</span>
              <span className="text-gray-300">·</span>
              <span className="text-xs text-gray-400">{formatDate(item.created_at)}</span>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </div>
      </a>
    )
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Library</h1>
        <p className="text-bt-light/60 text-sm mt-0.5">{groupName || 'Your group'} resources</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-5">

        {current.length === 0 && previous.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📚</p>
            <p className="text-gray-500 font-medium">Nothing here yet</p>
            <p className="text-gray-400 text-sm mt-1">Your leader will post resources here</p>
          </div>
        )}

        {/* Current Assignment */}
        {current.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className="text-xs font-bold text-bt-navy uppercase tracking-wide">Current Assignment</span>
              <span className="bg-bt-blue text-white text-xs px-2 py-0.5 rounded-full font-semibold">New</span>
            </div>
            <div className="space-y-3">
              {current.map(item => <ContentCard key={item.id} item={item} />)}
            </div>
          </div>
        )}

        {/* Previous Assignments */}
        {previous.length > 0 && (
          <div>
            <button
              onClick={() => setShowPrevious(!showPrevious)}
              className="w-full flex items-center justify-between bg-white rounded-2xl px-4 py-3.5 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Previous Assignments</span>
                <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full font-semibold">{previous.length}</span>
              </div>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${showPrevious ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showPrevious && (
              <div className="space-y-3 mt-3">
                {previous.map(item => <ContentCard key={item.id} item={item} />)}
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
