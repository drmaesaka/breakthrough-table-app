'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

type BannerState = 'hidden' | 'install' | 'enable' | 'enabling' | 'success' | 'failed'

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
      if (!localStorage.getItem('install_banner_dismissed')) setState('install')
      return
    }

    const hasPush = 'serviceWorker' in navigator && 'PushManager' in window
    if (hasPush && Notification.permission === 'default'
      && !localStorage.getItem('push_banner_dismissed')) {
      setState('enable')
    }
  }, [])

  function dismiss() {
    localStorage.setItem(
      state === 'install' ? 'install_banner_dismissed' : 'push_banner_dismissed', '1')
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
            {state === 'install' ? '📲' : state === 'success' ? '🎉' : '🔔'}
          </span>
          <div>
            {state === 'install' ? (
              <>
                <p className="text-white font-bold text-sm">Add to Home Screen</p>
                <p className="text-bt-light/70 text-xs mt-1 leading-relaxed">
                  To get nudge notifications, tap{' '}
                  <span className="text-bt-light font-semibold">Share</span>
                  {' '}then{' '}
                  <span className="text-bt-light font-semibold">"Add to Home Screen"</span>
                  {' '}in Safari, then open the app from your Home Screen.
                </p>
              </>
            ) : state === 'success' ? (
              <>
                <p className="text-white font-bold text-sm">Notifications are on!</p>
                <p className="text-bt-light/70 text-xs mt-1 leading-relaxed">
                  You can send yourself a test anytime from{' '}
                  <Link href="/preferences" className="text-bt-light font-semibold underline">Nudge Settings</Link>.
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
        {(state === 'install' || state === 'enable') && (
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
