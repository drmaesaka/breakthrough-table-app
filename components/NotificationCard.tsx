'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

type Status = 'checking' | 'on' | 'off' | 'install' | 'blocked' | 'unsupported' | 'working' | 'failed'

// Notifications, on the Profile page. Leaders asked for a place to turn
// them on that is always there — the dashboard banner comes and goes, and
// Nudge Settings is a level deeper than anyone looks. Shows the real state
// of THIS device and the one action that changes it.
export default function NotificationCard() {
  const [status, setStatus] = useState<Status>('checking')

  async function check() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const installed = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true
    if (isIOS && !installed) { setStatus('install'); return }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setStatus('unsupported'); return }
    if (Notification.permission === 'denied') { setStatus('blocked'); return }
    if (Notification.permission === 'default') { setStatus('off'); return }
    // Permission granted — but is this device actually registered?
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      setStatus(sub ? 'on' : 'off')
    } catch { setStatus('off') }
  }

  useEffect(() => { check() }, [])

  async function enable() {
    setStatus('working')
    try {
      const { data: { user } } = await createClient().auth.getUser()
      if (!user) { setStatus('failed'); return }
      const { subscribePush } = await import('@/components/PushInit')
      await subscribePush(user.id)
      setStatus('on')
    } catch (e) {
      console.error(e)
      setStatus(Notification.permission === 'denied' ? 'blocked' : 'failed')
    }
  }

  const dot = status === 'on' ? 'bg-green-500' : status === 'checking' ? 'bg-gray-300' : 'bg-amber-500'

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-bt-navy">Notifications</h3>
          <p className="text-gray-400 text-xs mt-0.5 flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
            {status === 'checking' && 'Checking this device…'}
            {status === 'on' && 'On for this device'}
            {status === 'off' && 'Off on this device'}
            {status === 'install' && 'Needs the app on your Home Screen first'}
            {status === 'blocked' && 'Blocked in your phone settings'}
            {status === 'unsupported' && 'Not supported in this browser'}
            {status === 'working' && 'Turning on…'}
            {status === 'failed' && "That didn't work"}
          </p>
        </div>
        {(status === 'off' || status === 'failed') && (
          <button onClick={enable} className="bg-bt-navy text-white text-xs font-bold px-4 py-2 rounded-xl">
            Turn on
          </button>
        )}
      </div>

      {status === 'install' && (
        <ol className="text-xs text-gray-500 space-y-1 leading-relaxed">
          <li>1. Tap <span className="font-semibold text-gray-700">Share</span> at the bottom of Safari (the square with an arrow)</li>
          <li>2. Tap <span className="font-semibold text-gray-700">Add to Home Screen</span>, then <span className="font-semibold text-gray-700">Add</span></li>
          <li>3. Open <span className="font-semibold text-gray-700">Breakthrough Table</span> from your Home Screen and come back here</li>
        </ol>
      )}
      {status === 'blocked' && (
        <p className="text-xs text-gray-500 leading-relaxed">
          Your phone said no once, so it won&apos;t ask again. Open your phone&apos;s{' '}
          <span className="font-semibold text-gray-700">Settings → Notifications → Breakthrough Table</span>, switch them on, then come back here.
        </p>
      )}
      {status === 'on' && (
        <p className="text-xs text-gray-400">
          Choose what you get told about, or send yourself a test, in{' '}
          <Link href="/preferences" className="text-bt-blue font-semibold">Nudge Settings →</Link>
        </p>
      )}
      {(status === 'off' || status === 'failed') && (
        <p className="text-xs text-gray-400">Nudges, table chat, your TC&apos;s posts and event reminders all arrive this way.</p>
      )}
    </div>
  )
}
