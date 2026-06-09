'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

const typeConfig: Record<string, { emoji: string; label: string; bg: string; text: string }> = {
  video:   { emoji: '🎥', label: 'Video',   bg: 'bg-red-50',    text: 'text-red-500' },
  pdf:     { emoji: '📄', label: 'PDF',     bg: 'bg-orange-50', text: 'text-orange-500' },
  article: { emoji: '📰', label: 'Article', bg: 'bg-green-50',  text: 'text-green-600' },
  link:    { emoji: '🔗', label: 'Link',    bg: 'bg-blue-50',   text: 'text-blue-500' },
}

export default function ContentPage() {
  const [content, setContent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('group_id').eq('id', user.id).single()
      if (prof?.group_id) {
        const { data } = await supabase.from('content').select('*').eq('group_id', prof.group_id).order('created_at', { ascending: false })
        setContent(data || [])
      }
      setLoading(false)
    }
    load()
  }, [router])

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-6">
        <h1 className="text-white text-2xl font-bold">Content Library</h1>
        <p className="text-bt-light/70 text-sm mt-0.5">Resources for your table</p>
      </div>

      <div className="px-5 py-5 pb-28 space-y-3">
        {loading && <p className="text-center text-gray-400 py-10">Loading...</p>}
        {!loading && content.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📚</p>
            <p className="text-gray-500 font-medium">No content yet</p>
            <p className="text-gray-400 text-sm mt-1">Your leader will add resources here</p>
          </div>
        )}
        {content.map(item => {
          const cfg = typeConfig[item.type] || typeConfig.link
          return (
            <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
              className="bg-white rounded-2xl p-4 shadow-sm flex items-start gap-4 active:opacity-70 block">
              <div className="text-3xl flex-shrink-0 mt-0.5">{cfg.emoji}</div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 leading-snug">{item.title}</p>
                {item.description && <p className="text-gray-400 text-sm mt-1 line-clamp-2">{item.description}</p>}
                <span className={`inline-block text-xs font-medium px-2.5 py-0.5 rounded-full mt-2 ${cfg.bg} ${cfg.text}`}>
                  {cfg.label}
                </span>
              </div>
              <svg className="flex-shrink-0 mt-1 text-gray-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </a>
          )
        })}
      </div>
      <BottomNav />
    </div>
  )
}