'use client'
import { useEffect } from 'react'
import { createClient } from '@/lib/supabase'

export default function OneSignalInit() {
  useEffect(() => {
    async function init() {
      if (typeof window === 'undefined') return

      const OneSignal = (await import('react-onesignal')).default

      await OneSignal.init({
        appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID!,
        safari_web_id: '',
        notifyButton: { enable: false },
        allowLocalhostAsSecureOrigin: true,
      })

      // Link the OneSignal player ID to the logged-in user
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Set external user ID so we can target by Supabase user ID
      await OneSignal.login(user.id)

      // Save onesignal_id to profile for reference
      const playerId = await OneSignal.User.PushSubscription.id
      if (playerId) {
        await supabase.from('profiles').update({ onesignal_id: playerId }).eq('id', user.id)
      }
    }

    init().catch(console.error)
  }, [])

  return null
}
