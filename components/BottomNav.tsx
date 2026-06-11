'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

export default function BottomNav() {
  const pathname = usePathname()
  const [isLeader, setIsLeader] = useState(false)

  useEffect(() => {
    async function checkRole() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (data?.role === 'leader') setIsLeader(true)
    }
    checkRole()
  }, [])

  const tabs = isLeader
    ? [
        { href: '/tasks', label: 'Tasks', icon: <TaskIcon /> },
        { href: '/messages', label: 'Chat', icon: <ChatIcon /> },
        { href: '/analytics', label: 'Stats', icon: <StatsIcon /> },
        { href: '/profile', label: 'Profile', icon: <ProfileIcon /> },
        { href: '/admin', label: 'Admin', icon: <AdminIcon /> },
      ]
    : [
        { href: '/tasks', label: 'Tasks', icon: <TaskIcon /> },
        { href: '/messages', label: 'Chat', icon: <ChatIcon /> },
        { href: '/events', label: 'Events', icon: <EventsIcon /> },
        { href: '/library', label: 'Library', icon: <LibraryIcon /> },
        { href: '/profile', label: 'Profile', icon: <ProfileIcon /> },
      ]

  return (
    <>
      {/* Floating home button — hidden on dashboard itself */}
      {pathname !== '/dashboard' && (
        <Link href="/dashboard"
          className="fixed top-4 right-4 z-50 bg-bt-navy/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-lg flex flex-col active:scale-95 transition-transform">
          <div>
            <span className="text-white text-xs font-normal">break</span><span className="text-white text-xs font-bold">through</span>
          </div>
          <div className="text-bt-light text-xs font-normal text-right -mt-0.5">table</div>
        </Link>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
        <div className="flex">
          {tabs.map(tab => {
            const active = pathname === tab.href
            return (
              <Link key={tab.href} href={tab.href}
                className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-xs font-medium transition-colors ${
                  active ? 'text-bt-navy' : 'text-gray-400'
                }`}>
                <span className={active ? 'text-bt-navy' : 'text-gray-400'}>{tab.icon}</span>
                {tab.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}

function TaskIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
    </svg>
  )
}
function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  )
}
function LibraryIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
    </svg>
  )
}
function GroupIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  )
}
function StatsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  )
}
function ProfileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  )
}
function JournalIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )
}

function EventsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function AdminIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  )
}