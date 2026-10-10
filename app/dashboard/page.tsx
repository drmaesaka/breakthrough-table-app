'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import PushSetupBanner from '@/components/PushSetupBanner'
import WelcomeScreen from '@/components/WelcomeScreen'
import { fetchMyTable } from '@/lib/my-table'
import { quoteOfTheDay } from '@/lib/daily-quote'

export default function DashboardPage() {
  const [profile, setProfile] = useState<any>(null)
  const [groupName, setGroupName] = useState('')
  const router = useRouter()

  // Home is just the shortcuts (2026-10-07). The meeting card, challenge and
  // "before your next meeting" were too much; it went through several
  // versions (progress bar → This week → meeting card) before this.

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase.from('profiles').select('*, groups(name)').eq('id', user.id).single()
      if (prof) {
        setProfile(prof)
        setGroupName(prof.groups?.name || '')
        if (prof.group_id && !prof.groups?.name) fetchMyTable().then(t => { if (t?.name) setGroupName(t.name) })
      }
    }
    load()
  }, [router])

  const firstName = profile?.full_name?.split(' ')[0] || 'there'
  const isMember = Boolean(profile?.group_id) && profile?.role !== 'leader'

  return (
    <div className="bg-bt-pale flex flex-col" style={{ minHeight: '100dvh' }}>
      {profile && <WelcomeScreen userId={profile.id} firstName={firstName} />}
      <div className="bg-bt-navy px-5 pt-16 pb-8">
        {/* The top-right corner belongs to the notifications bell. */}
        <div className="flex items-start justify-between pr-10">
          <div>
            <p className="text-bt-light text-sm font-medium">Welcome back,</p>
            <h1 className="text-white text-3xl font-bold mt-0.5">{firstName} 👋</h1>
            {groupName && <p className="text-bt-light/70 text-sm mt-1">🪑 Your table: <span className="text-white font-semibold">{groupName}</span></p>}
          </div>
        </div>
      </div>

      {/* Members: roomier tiles, then the day's quote pinned just above the
          tabs (2026-10-10); the bottom padding is the tab bar's height. */}
      <div className="flex-1 flex flex-col py-5 space-y-4"
        style={{ paddingBottom: isMember ? 'calc(76px + var(--nav-lift, 0px) + var(--table-bar, 0px))' : '9rem' }}>
        <PushSetupBanner />
        <div className="px-5 space-y-4 flex-1 flex flex-col">
        {/* No group state */}
        {profile && !profile.group_id && (
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <p className="text-5xl mb-3">👋</p>
            <h2 className="font-bold text-bt-navy text-lg">You're all set!</h2>
            <p className="text-gray-400 text-sm mt-2 leading-relaxed">
              Your account is ready. You'll be added to your Breakthrough Table group shortly — your leader will assign you before your next meeting.
            </p>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-gray-400 text-xs">Questions? Reach out to your table leader.</p>
            </div>
          </div>
        )}

        {/* Sign-ups sit outside the has-a-table gate on purpose: alumni keep
            their account with no group_id, and the alumni table is for them. */}
        {profile && !profile.group_id && (
          <Link href="/sessions"
            className="bg-white rounded-2xl p-4 shadow-sm active:scale-95 transition-transform block">
            <div className="text-3xl mb-2">🪑</div>
            <p className="font-semibold text-bt-navy text-sm">Table Sign-Ups</p>
            <p className="text-gray-400 text-xs mt-0.5">Alumni & monthly drop-in tables</p>
          </Link>
        )}

        {/* Quick links - only show if in a group */}
        {profile?.group_id && (
          <>
            <div className={isMember ? 'grid grid-cols-2 gap-3.5' : 'grid grid-cols-2 gap-3'}>
              {[
                { href: '/group', emoji: '✅', title: 'My Table', sub: 'Chat, habits & reading' },
                { href: '/events', emoji: '📅', title: 'Events', sub: 'Upcoming BT events' },
                // Meeting outlines are for TCs only.
                ...(profile?.role === 'leader' ? [{ href: '/meetings', emoji: '🗒️', title: 'Meetings', sub: "This meeting's outline" }] : []),
                { href: '/library', emoji: '📚', title: 'Library', sub: 'Resources & videos' },
                { href: '/booking', emoji: '🏢', title: 'Book a Room', sub: 'Reserve your space' },
                { href: '/directory', emoji: '👥', title: 'Directory', sub: 'Find BT members' },
                { href: '/preferences', emoji: '🔔', title: 'Nudge Settings', sub: 'Customize check-ins' },
              ].map(card => (
                isMember ? (
                  <Link key={card.href} href={card.href}
                    className="bg-white rounded-2xl p-4 shadow-sm active:scale-95 transition-transform flex flex-col justify-center min-h-[7.25rem]">
                    <div className="text-4xl mb-2">{card.emoji}</div>
                    <p className="font-bold text-bt-navy text-base leading-tight">{card.title}</p>
                    <p className="text-gray-400 text-xs mt-1">{card.sub}</p>
                  </Link>
                ) : (
                <Link key={card.href} href={card.href}
                  className="bg-white rounded-2xl p-4 shadow-sm active:scale-95 transition-transform block">
                  <div className="text-3xl mb-2">{card.emoji}</div>
                  <p className="font-semibold text-bt-navy text-sm">{card.title}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{card.sub}</p>
                </Link>
                )
              ))}
            </div>
            {isMember && (() => {
              const q = quoteOfTheDay()
              return (
                <figure className="mt-auto pt-2 px-2 text-center">
                  <blockquote className="text-bt-navy/80 text-sm italic leading-relaxed">“{q.text}”</blockquote>
                  <figcaption className="text-gray-400 text-xs mt-1">— {q.by}</figcaption>
                </figure>
              )
            })()}
          </>
        )}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}