'use client'
import { useEffect } from 'react'
import { createClient } from '@/lib/supabase'

export default function PushInit() {
  useEffect(() => {
    async function init() {
      if (typeof window === 'undefined') return
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      try {
        // Register service worker
        const reg = await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready

        // Check permission
        if (Notification.permission === 'denied') return
        if (Notification.permission === 'default') return // wait for user to tap Allow

        // Already granted — subscribe
        await subscribe(reg, user.id)
      } catch (err) {
        console.error('PushInit error:', err)
      }
    }
    init()
  }, [])

  return null
}

export async function subscribePush(userId: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push not supported')
  }

  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permission denied')

  await subscribe(reg, userId)
  return true
}

async function subscribe(reg: ServiceWorkerRegistration, userId: string) {
  const existing = await reg.pushManager.getSubscription()
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
  })

  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(sub.toJSON()),
  })
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}
