'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'
import PushSetupBanner from '@/components/PushSetupBanner'
import WelcomeScreen from '@/components/WelcomeScreen'
import { localDay } from '@/lib/dates'

export default function DashboardPage() {
  const [profile, setProfile] = useState<any>(null)
  const [groupName, setGroupName] = useState('')
  const [taskStats, setTaskStats] = useState({ total: 0, completed: 0 })
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase.from('profiles').select('*, groups(name), streak').eq('id', user.id).single()
      if (prof) {
        setProfile(prof)
        setGroupName(prof.groups?.name || '')
      }

      if (prof?.group_id) {
        // Must match /tasks exactly: only the current period's tasks, plus the
        // daily habit as one more item. Counting archived tasks and omitting
        // the habit made this number drift further from the tasks page every
        // period — by period five it showed roughly a fifth of the real figure.
        const [{ data: tasks }, { data: completions }, { data: habitToday }] = await Promise.all([
          supabase.from('tasks').select('id').eq('group_id', prof.group_id).eq('archived', false),
          supabase.from('task_completions').select('task_id').eq('user_id', user.id),
          supabase.from('habit_completions').select('id')
            .eq('user_id', user.id).eq('completed_date', localDay()).maybeSingle(),
        ])
        if (tasks) {
          const completedIds = new Set(completions?.map((c: any) => c.task_id))
          setTaskStats({
            total: tasks.length + 1,
            completed: tasks.filter((t: any) => completedIds.has(t.id)).length + (habitToday ? 1 : 0),
          })
        }
      }
    }
    load()
  }, [router])

  const firstName = profile?.full_name?.split(' ')[0] || 'there'
  const adherence = taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0

  return (
    <div className="min-h-screen bg-bt-pale">
      {profile && <WelcomeScreen userId={profile.id} firstName={firstName} />}
      <div className="bg-bt-navy px-5 pt-16 pb-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-bt-light text-sm font-medium">Welcome back,</p>
            <h1 className="text-white text-3xl font-bold mt-0.5">{firstName} 👋</h1>
            {groupName && <p className="text-bt-light/70 text-sm mt-1">{groupName}</p>}
          </div>
          <Link href="/profile"
            className="mt-1 w-9 h-9 rounded-full bg-white/15 flex items-center justify-center">
            <span className="text-white text-xs font-bold">
              {(() => { const parts = (profile?.full_name || '').trim().split(' '); return parts.length >= 2 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : firstName.slice(0,2).toUpperCase() })()}
            </span>
          </Link>
        </div>
      </div>

      <div className="py-5 pb-28 space-y-4">
        <PushSetupBanner />
        <div className="px-5 space-y-4">
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

        {/* Adherence card - only show if in a group */}
        {profile?.group_id && (
          <>
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <p className="text-gray-400 text-sm font-medium">Your Adherence This Period</p>
              <div className="flex items-end gap-2 mt-2 mb-3">
                <span className="text-5xl font-bold text-bt-navy">{adherence}%</span>
                <span className="text-gray-400 text-sm pb-1.5">{taskStats.completed} of {taskStats.total} done</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-bt-blue rounded-full transition-all duration-500" style={{ width: `${adherence}%` }} />
              </div>
              {profile?.streak > 0 && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                  <span className="text-xl">🔥</span>
                  <p className="text-sm font-semibold text-gray-700">{profile.streak} period streak</p>
                  <p className="text-xs text-gray-400">— keep it going!</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { href: '/tasks', emoji: '✅', title: 'My Tasks', sub: 'Track & complete' },
                // /journal had no inbound link anywhere, so reflection prompts
                // were only reachable by typing the URL.
                { href: '/journal', emoji: '📓', title: 'Reflections', sub: "Your table's prompts" },
                { href: '/events', emoji: '📅', title: 'Events', sub: 'Upcoming BT events' },
                { href: '/meetings', emoji: '🗒️', title: 'Meetings', sub: "This meeting's outline" },
                { href: '/sessions', emoji: '🪑', title: 'Sign-Ups', sub: 'Alumni & drop-in tables' },
                { href: '/library', emoji: '📚', title: 'Library', sub: 'Resources & videos' },
                { href: '/booking', emoji: '🏢', title: 'Book a Room', sub: 'Reserve your space' },
                { href: '/directory', emoji: '👥', title: 'Directory', sub: 'Find BT members' },
                { href: '/preferences', emoji: '🔔', title: 'Nudge Settings', sub: 'Customize check-ins' },
              ].map(card => (
                <Link key={card.href} href={card.href}
                  className="bg-white rounded-2xl p-4 shadow-sm active:scale-95 transition-transform block">
                  <div className="text-3xl mb-2">{card.emoji}</div>
                  <p className="font-semibold text-bt-navy text-sm">{card.title}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{card.sub}</p>
                </Link>
              ))}
            </div>
          </>
        )}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}