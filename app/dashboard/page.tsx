'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/login')
      } else {
        setUser(user)
      }
    })
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Breakthrough Table</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email}</span>
          <button
            onClick={handleSignOut}
            className="text-sm text-red-500 hover:text-red-700 font-medium"
          >
            Sign Out
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-semibold text-gray-800 mb-8">Dashboard</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <DashboardCard title="My Tasks" description="View and complete your bi-monthly tasks" href="/tasks" />
          <DashboardCard title="Group Chat" description="Message your table group" href="/messages" />
          <DashboardCard title="Content Library" description="Videos, PDFs, and resources" href="/content" />
          <DashboardCard title="My Group" description="See your group and adherence" href="/group" />
        </div>
      </main>
    </div>
  )
}

function DashboardCard({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <a
      href={href}
      className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition block"
    >
      <h3 className="text-lg font-semibold text-gray-800 mb-1">{title}</h3>
      <p className="text-sm text-gray-500">{description}</p>
    </a>
  )
}