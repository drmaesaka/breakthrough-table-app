'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function ContentPage() {
  const [content, setContent] = useState<any[]>([])
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      const { data: profile } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single()

      if (profile?.group_id) {
        const { data: items } = await supabase
          .from('content')
          .select('*')
          .eq('group_id', profile.group_id)
          .order('created_at', { ascending: false })
        setContent(items || [])
      }
      setLoading(false)
    }
    load()
  }, [])

  const typeIcon: Record<string, string> = {
    video: '🎥',
    pdf: '📄',
    article: '📝',
    link: '🔗'
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Breakthrough Table</h1>
        <a href="/dashboard" className="text-sm text-blue-600 hover:underline">← Dashboard</a>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-semibold text-gray-800 mb-8">Content Library</h2>

        {content.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center text-gray-500">
            No content yet. Your leader will add resources here.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {content.map(item => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition flex items-start gap-4"
              >
                <span className="text-2xl">{typeIcon[item.content_type] || '📎'}</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">{item.title}</h3>
                  {item.description && <p className="text-sm text-gray-500 mt-1">{item.description}</p>}
                  <span className="text-xs text-blue-500 mt-2 inline-block capitalize">{item.content_type}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}