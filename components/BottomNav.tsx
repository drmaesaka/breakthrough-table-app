'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { pickTable, setCurrentTable, onCurrentTableChange, getCurrentTable, ALL_TABLES } from '@/lib/current-table'

export default function BottomNav() {
  const pathname = usePathname()
  const [isLeader, setIsLeader] = useState(false)
  const [unread, setUnread] = useState(0)
  // TCs: every table they can work in (the one they sit at, then the ones
  // they lead) and the one they are working in now.
  const [tables, setTables] = useState<{ id: string; name: string; home: boolean }[]>([])
  const [current, setCurrent] = useState<string | null>(null)

  useEffect(() => {
    async function checkRole() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('role, group_id, groups(name)').eq('id', user.id).single()
      if (data?.role !== 'leader') return
      setIsLeader(true)
      const home = data.group_id ? { id: data.group_id as string, name: (data.groups as any)?.name || 'My table', home: true } : null
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/my-groups', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } }).catch(() => null)
      const led = res && res.ok ? ((await res.json()).groups || []) : []
      const all = [...(home ? [home] : []), ...led.filter((g: any) => g.id !== home?.id).map((g: any) => ({ id: g.id, name: g.name, home: false }))]
      setTables(all)
      setCurrent(getCurrentTable() === ALL_TABLES ? ALL_TABLES : pickTable(all.map(t => t.id), home?.id))
    }
    checkRole()
    return onCurrentTableChange(setCurrent)
  }, [])

  // The bar adds height above the tabs; screens with a pinned message box
  // read this to stay clear of it.
  useEffect(() => {
    document.documentElement.style.setProperty('--table-bar', tables.length ? '34px' : '0px')
  }, [tables.length])

  // Unread count for the bell: on every screen change and when the app comes
  // back to the foreground (an installed PWA resumes without reloading).
  useEffect(() => {
    let alive = true
    async function refresh() {
      try {
        const { data: { session } } = await createClient().auth.getSession()
        if (!session?.access_token) return
        const res = await fetch('/api/notifications?count=1', { headers: { Authorization: `Bearer ${session.access_token}` } })
        if (res.ok && alive) setUnread((await res.json()).unread || 0)
      } catch { /* the bell just shows no number */ }
    }
    refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [pathname])

  // Leaders get My Table too. Without it a TC had no way to see their own
  // table the way their members see it, and no way to check what a member
  // actually looks at — every other leader screen is the leader's view.
  // Home is the first tab. Tapping the logo top-right also went home, but
  // nobody guessed that (leader feedback 2026-09-21). Leaders lose the Stats
  // tab to make room — Stats is a card on the dashboard instead.
  // Tasks merged into My Table (2026-10-05): one place for "me and my table".
  const tabs = isLeader
    ? [
        { href: '/dashboard', label: 'Home', icon: <HomeIcon /> },
        { href: '/group', label: 'My Table', icon: <GroupIcon /> },
        { href: '/messages', label: 'Chat', icon: <ChatIcon /> },
        { href: '/leaders', label: 'TC Room', icon: <LeaderIcon /> },
        { href: '/admin', label: 'Admin', icon: <AdminIcon /> },
        { href: '/profile', label: 'Profile', icon: <ProfileIcon /> },
      ]
    : [
        { href: '/dashboard', label: 'Home', icon: <HomeIcon /> },
        { href: '/group', label: 'My Table', icon: <GroupIcon /> },
        { href: '/messages', label: 'Chat', icon: <ChatIcon /> },
        { href: '/library', label: 'Library', icon: <LibraryIcon /> },
        { href: '/profile', label: 'Profile', icon: <ProfileIcon /> },
      ]

  return (
    <>
      {/* Notifications bell, top right. It replaced a "breakthrough table"
          logo that went Home, which nobody guessed (2026-10-06); Home is the
          first tab. Hidden on the inbox itself. */}
      {pathname !== '/notifications' && (
        <Link href="/notifications" aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
          // Below the status bar: at a fixed top-4 it sat on the battery icon.
          style={{ top: 'max(1rem, calc(env(safe-area-inset-top) + 0.5rem))' }}
          className="fixed right-4 z-50 w-9 h-9 bg-bt-navy/90 backdrop-blur-sm rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform">
          <BellIcon />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
        {/* Which table a TC is working in, on every screen, with a switch.
            My Table and Admin follow it. */}
        {tables.length > 0 && (() => {
          // "All tables" is an Admin view; elsewhere the bar shows the one
          // table the screen is actually on.
          const allOffered = pathname.startsWith('/admin') && tables.length > 1
          const showAll = allOffered && current === ALL_TABLES
          const t = tables.find(x => x.id === current) || tables[0]
          return (
            <div className="relative h-[34px] bg-bt-navy text-white flex items-center justify-center gap-1.5 text-xs font-semibold">
              <span className="text-bt-light/70 font-medium">Working in</span>
              <span className="truncate max-w-[55%]">{showAll ? '🌐 All tables' : `🪑 ${t.name}`}</span>
              {tables.length > 1 && (
                <>
                  <span className="text-bt-light/70">▾</span>
                  <select value={showAll ? ALL_TABLES : t.id} aria-label="Switch table"
                    onChange={e => { setCurrent(e.target.value); setCurrentTable(e.target.value) }}
                    className="absolute inset-0 opacity-0 w-full">
                    {allOffered && <option value={ALL_TABLES}>All tables</option>}
                    {tables.map(x => <option key={x.id} value={x.id}>{x.name}{x.home ? ' (your table)' : ''}</option>)}
                  </select>
                </>
              )}
            </div>
          )
        })()}
        <div className="flex" style={{ paddingBottom: 'var(--nav-lift)' }}>
          {tabs.map(tab => {
            const active = pathname === tab.href
            return (
              <Link key={tab.href} href={tab.href}
                className={`flex-1 min-w-0 flex flex-col items-center py-2 gap-0.5 text-[11px] leading-tight font-medium whitespace-nowrap transition-colors ${
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

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10.5V20h5v-5h4v5h5v-9.5" />
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

function LeaderIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7l4 3 5-6 5 6 4-3v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
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
function BellIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  )
}
