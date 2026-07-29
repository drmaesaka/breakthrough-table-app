'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Image from 'next/image'

// Step 2 exists because the app's entire mechanism is the nudge, and on iOS
// web push only works once the PWA is installed to the Home Screen. Members
// who skipped this (3 of the first 5) silently received nothing. Onboarding
// now walks every member to working notifications before they enter the app —
// skippable, but skipping is the small link, not the big button.
type Step = 'welcome' | 'notifications'

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>('welcome')
  const [firstName, setFirstName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [memberCount, setMemberCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pushState, setPushState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle')
  const [needsInstall, setNeedsInstall] = useState(false)
  const [pushSupported, setPushSupported] = useState(true)
  const router = useRouter()

  useEffect(() => {
    // What this device needs before push can work.
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true
    setNeedsInstall(isIOS && !isInstalled)
    setPushSupported('serviceWorker' in navigator && 'PushManager' in window)

    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, group_id, onboarded, groups(name)')
        .eq('id', user.id)
        .single()

      // Skip onboarding if already done
      if (prof?.onboarded) { router.push('/dashboard'); return }

      setFirstName(prof?.full_name?.split(' ')[0] || 'there')
      setGroupName((prof?.groups as any)?.name || '')

      if (prof?.group_id) {
        const { data: members } = await supabase
          .from('profiles').select('id').eq('group_id', prof.group_id)
        setMemberCount(members?.length || 0)
      }

      setLoading(false)
    }
    load()
  }, [router])

  async function enablePush() {
    setPushState('working')
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setPushState('failed'); return }
      const { subscribePush } = await import('@/components/PushInit')
      await subscribePush(user.id)
      setPushState('done')
    } catch (e) {
      console.error('onboarding push setup failed:', e)
      setPushState('failed')
    }
  }

  async function finish() {
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    // Not worth blocking entry to the app on, but a silent failure means the
    // member gets shown onboarding again later with no explanation.
    const { error } = await supabase.from('profiles').update({ onboarded: true }).eq('id', user.id)
    if (error) console.error('onboarding flag failed:', error.message)
    router.push('/dashboard')
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-navy flex items-center justify-center">
      <p className="text-white/50">Loading...</p>
    </div>
  )

  if (step === 'notifications') {
    return (
      <div className="min-h-screen bg-bt-navy flex flex-col items-center justify-center pb-10 pt-16 px-8">
        <span className="text-5xl mb-6">{pushState === 'done' ? '🎉' : needsInstall ? '📲' : '🔔'}</span>

        <div className="text-center max-w-xs">
          {pushState === 'done' ? (
            <>
              <h1 className="text-white text-2xl font-bold mb-3">Notifications are on</h1>
              <p className="text-white/50 text-base leading-relaxed mb-8">
                Your nudges will reach this device. You can adjust times and tone
                anytime in Nudge Settings.
              </p>
            </>
          ) : needsInstall ? (
            <>
              <h1 className="text-white text-2xl font-bold mb-3">One step for nudges</h1>
              <p className="text-white/50 text-base leading-relaxed mb-5">
                iPhones only deliver notifications to installed apps. It takes
                ten seconds:
              </p>
              <ol className="text-left text-white/70 text-sm leading-relaxed space-y-3 mb-8">
                <li>1. Tap the <span className="text-white font-semibold">Share</span> button in Safari</li>
                <li>2. Choose <span className="text-white font-semibold">"Add to Home Screen"</span></li>
                <li>3. Open <span className="text-white font-semibold">Breakthrough Table</span> from your Home Screen and sign in there</li>
                <li>4. Tap <span className="text-white font-semibold">Allow Notifications</span> when asked</li>
              </ol>
            </>
          ) : !pushSupported ? (
            <>
              <h1 className="text-white text-2xl font-bold mb-3">Notifications</h1>
              <p className="text-white/50 text-base leading-relaxed mb-8">
                This browser doesn&apos;t support notifications. Open the app on
                your phone later to turn on nudges — they&apos;re the heart of
                how your table keeps you on track.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-white text-2xl font-bold mb-3">Turn on your nudges</h1>
              <p className="text-white/50 text-base leading-relaxed mb-8">
                Your table runs on gentle reminders. Allow notifications so
                yours can actually reach you.
              </p>
              {pushState === 'failed' && (
                <p className="text-red-300 text-sm mb-4">
                  That didn&apos;t work — you can finish this later in Nudge Settings.
                </p>
              )}
            </>
          )}
        </div>

        {pushState !== 'done' && !needsInstall && pushSupported && (
          <button
            onClick={enablePush}
            disabled={pushState === 'working'}
            className="w-full max-w-xs bg-white text-bt-navy py-4 rounded-2xl font-bold text-base disabled:opacity-50 mb-3">
            {pushState === 'working' ? 'Enabling...' : 'Allow Notifications'}
          </button>
        )}

        <button
          onClick={finish}
          disabled={saving}
          className={`w-full max-w-xs py-4 rounded-2xl font-bold text-base disabled:opacity-50 ${
            pushState === 'done' || needsInstall || !pushSupported
              ? 'bg-white text-bt-navy'
              : 'bg-transparent text-white/40 underline text-sm'
          }`}>
          {saving ? 'One moment...'
            : pushState === 'done' ? "Enter the app →"
            : needsInstall ? "Got it — I'll open from my Home Screen"
            : !pushSupported ? 'Continue →'
            : 'Skip for now'}
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bt-navy flex flex-col items-center justify-center pb-10 pt-16 px-8">
      <div className="bg-white rounded-2xl px-5 py-3 mb-10">
        <Image src="/bt-logo.png" alt="Breakthrough Table" width={180} height={63} className="object-contain" />
      </div>

      <div className="text-center max-w-xs">
        <h1 className="text-white text-3xl font-bold mb-3">
          Welcome to your table, {firstName}.
        </h1>
        <p className="text-white/50 text-base leading-relaxed mb-2">
          {groupName ? `You've joined ${groupName}.` : "You've joined Breakthrough Table."}
        </p>
        {memberCount > 1 && (
          <p className="text-white/30 text-sm mb-8">
            {memberCount} member{memberCount !== 1 ? 's' : ''} in your group
          </p>
        )}
        <p className="text-white/40 text-sm leading-relaxed mt-4 mb-6">
          Accountability starts here.
        </p>
      </div>

      <button
        onClick={() => setStep('notifications')}
        className="w-full max-w-xs bg-white text-bt-navy py-4 rounded-2xl font-bold text-base">
        Let&apos;s go →
      </button>
    </div>
  )
}
