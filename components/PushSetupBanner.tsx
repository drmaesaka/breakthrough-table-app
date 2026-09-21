'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

type BannerState = 'hidden' | 'install' | 'enable' | 'enabling' | 'success' | 'failed' | 'blocked'

// A dismissal used to be permanent, so one tap on the X in week one meant
// the member was never asked again — and most never turned notifications
// on. Now it snoozes for three days and comes back until push is working.
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000
function snoozed(key: string) {
  try { return Number(localStorage.getItem(key) || 0) > Date.now() } catch { return false }
}

// Walks a new member to working notifications from the dashboard:
// iOS Safari without the PWA installed → Add to Home Screen instructions;
// push-capable but permission never granted → one-tap enable.
export default function PushSetupBanner() {
  const [state, setState] = useState<BannerState>('hidden')

  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true

    if (isIOS && !isInstalled) {
      if (!snoozed('install_banner_snooze')) setState('install')
      return
    }

    const hasPush = 'serviceWorker' in navigator && 'PushManager' in window
    if (!hasPush || snoozed('push_banner_snooze')) return
    if (Notification.permission === 'default') setState('enable')
    // They tapped "Don't allow" once; the browser will not ask again, so the
    // fix is in the phone's settings and they need to be told that.
    if (Notification.permission === 'denied') setState('blocked')
  }, [])

  function dismiss() {
    try {
      localStorage.setItem(state === 'install' ? 'install_banner_snooze' : 'push_banner_snooze', String(Date.now() + SNOOZE_MS))
    } catch {}
    setState('hidden')
  }

  async function enable() {
    setState('enabling')
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setState('failed'); return }
      const { subscribePush } = await import('@/components/PushInit')
      await subscribePush(user.id)
      setState('success')
    } catch (e) {
      console.error(e)
      setState('failed')
    }
  }

  if (state === 'hidden') return null

  return (
    <div className="mx-5 mb-4 bg-bt-navy rounded-2xl p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">
            {state === 'install' ? '📲' : state === 'success' ? '🎉' : state === 'blocked' ? '🔕' : '🔔'}
          </span>
          <div>
            {state === 'install' ? (
              <>
                <p className="text-white font-bold text-sm">You're missing notifications</p>
                <p className="text-bt-light/70 text-xs mt-1 leading-relaxed">
                  iPhones only deliver them to installed apps. Two minutes:
                </p>
                <ol className="text-bt-light/80 text-xs mt-1.5 space-y-1 leading-relaxed">
                  <li>1. Tap <span className="text-white font-semibold">Share</span> at the bottom of Safari (square with an arrow)</li>
                  <li>2. Tap <span className="text-white font-semibold">Add to Home Screen</span>, then <span className="text-white font-semibold">Add</span></li>
                  <li>3. Open <span className="text-white font-semibold">Breakthrough Table</span> from your Home Screen and tap <span className="text-white font-semibold">Allow</span></li>
                </ol>
              </>
            ) : state === 'success' ? (
              <>
                <p className="text-white font-bold text-sm">Notifications are on!</p>
                <p className="text-bt-light/70 text-xs mt-1 leading-relaxed">
                  You can send yourself a test anytime from{' '}
                  <Link href="/preferences" className="text-bt-light font-semibold underline">Nudge Settings</Link>.
                </p>
              </>
            ) : state === 'blocked' ? (
              <>
                <p className="text-white font-bold text-sm">Notifications are blocked</p>
                <p className="text-bt-light/70 text-xs mt-1 leading-relaxed">
                  Your phone said no once, so it won&apos;t ask again. Open your phone&apos;s{' '}
                  <span className="text-bt-light font-semibold">Settings → Notifications → Breakthrough Table</span>
                  {' '}and switch them on, then come back here.
                </p>
              </>
            ) : state === 'failed' ? (
              <>
                <p className="text-white font-bold text-sm">That didn't work</p>
                <p className="text-bt-light/70 text-xs mt-1 leading-relaxed">
                  Head to{' '}
                  <Link href="/preferences" className="text-bt-light font-semibold underline">Nudge Settings</Link>
                  {' '}to finish setting up notifications.
                </p>
              </>
            ) : (
              <>
                <p className="text-white font-bold text-sm">Turn on nudges</p>
                <p className="text-bt-light/70 text-xs mt-1 leading-relaxed">
                  Allow notifications so your reminders and table updates can reach you.
                </p>
                <button onClick={enable} disabled={state === 'enabling'}
                  className="mt-2 bg-white text-bt-navy text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-50">
                  {state === 'enabling' ? 'Enabling...' : 'Allow Notifications'}
                </button>
              </>
            )}
          </div>
        </div>
        {(state === 'install' || state === 'enable' || state === 'blocked') && (
          <button onClick={dismiss} className="text-bt-light/50 hover:text-white flex-shrink-0 mt-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
