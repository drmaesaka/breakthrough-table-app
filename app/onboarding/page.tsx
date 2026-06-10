'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Image from 'next/image'

export default function OnboardingPage() {
  const [step, setStep] = useState(0)
  const [habit, setHabit] = useState('')
  const [saving, setSaving] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [memberCount, setMemberCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, group_id, current_habit, onboarded, groups(name)')
        .eq('id', user.id)
        .single()

      // Skip onboarding if already done
      if (prof?.onboarded) { router.push('/dashboard'); return }

      setFirstName(prof?.full_name?.split(' ')[0] || 'there')
      setGroupName((prof?.groups as any)?.name || '')

      if (prof?.group_id) {
        const [{ data: members }, { data: tasks }] = await Promise.all([
          supabase.from('profiles').select('id').eq('group_id', prof.group_id),
          supabase.from('tasks').select('id').eq('group_id', prof.group_id).eq('archived', false),
        ])
        setMemberCount(members?.length || 0)
        setTaskCount(tasks?.length || 0)
      }

      setLoading(false)
    }
    load()
  }, [router])

  async function saveHabitAndFinish() {
    if (!habit.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('profiles').update({
      current_habit: habit.trim(),
      onboarded: true,
    }).eq('id', user.id)
    router.push('/dashboard')
  }

  async function skipAndFinish() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('profiles').update({ onboarded: true }).eq('id', user.id)
    router.push('/dashboard')
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-navy flex items-center justify-center">
      <p className="text-white/50">Loading...</p>
    </div>
  )

  const steps = [
    // Step 0: Welcome
    <div key="welcome" className="flex flex-col items-center text-center px-8">
      <div className="bg-white rounded-2xl px-5 py-3 mb-8">
        <Image src="/bt-logo.png" alt="Breakthrough Table" width={180} height={63} className="object-contain" />
      </div>
      <h1 className="text-white text-3xl font-bold mb-3">Welcome, {firstName} 👋</h1>
      <p className="text-bt-light/70 text-base leading-relaxed mb-2">
        You've joined{groupName ? ` ${groupName}` : ' your Breakthrough Table'}.
      </p>
      {memberCount > 1 && (
        <p className="text-bt-light/50 text-sm mb-8">
          {memberCount} member{memberCount !== 1 ? 's' : ''} in your group
        </p>
      )}
      <p className="text-bt-light/60 text-sm leading-relaxed mb-10 max-w-xs">
        This app tracks two things every period: your <span className="text-white font-semibold">content assignments</span> and your <span className="text-white font-semibold">personal habit</span>. Let's get you set up.
      </p>
      <button onClick={() => setStep(1)}
        className="w-full bg-white text-bt-navy py-4 rounded-2xl font-bold text-base">
        Let's go →
      </button>
    </div>,

    // Step 1: Set your habit
    <div key="habit" className="flex flex-col px-8 w-full">
      <div className="mb-8 text-center">
        <p className="text-5xl mb-4">🎯</p>
        <h2 className="text-white text-2xl font-bold mb-2">What's your habit?</h2>
        <p className="text-bt-light/60 text-sm leading-relaxed">
          The one behavior you're committing to build this period. Be specific — you'll check in on this every day.
        </p>
      </div>
      <input
        value={habit}
        onChange={e => setHabit(e.target.value)}
        placeholder="e.g. Morning cold plunge, Daily journaling, 20 min walk..."
        className="w-full px-4 py-4 rounded-2xl border-2 border-white/20 bg-white/10 text-white placeholder-white/30 focus:outline-none focus:border-white/50 text-base mb-3"
        autoFocus
      />
      <p className="text-bt-light/40 text-xs text-center mb-8">You can change this anytime from your profile</p>
      <button
        onClick={saveHabitAndFinish}
        disabled={saving || !habit.trim()}
        className="w-full bg-white text-bt-navy py-4 rounded-2xl font-bold text-base disabled:opacity-40 mb-3">
        {saving ? 'Saving...' : 'Set My Habit →'}
      </button>
      <button onClick={skipAndFinish} className="text-bt-light/40 text-sm text-center py-2">
        Skip for now
      </button>
    </div>,
  ]

  return (
    <div className="min-h-screen bg-bt-navy flex flex-col items-center justify-center pb-10 pt-16">
      {/* Progress dots */}
      <div className="flex gap-2 mb-10">
        {steps.map((_, i) => (
          <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
            i === step ? 'w-8 bg-white' : i < step ? 'w-4 bg-white/50' : 'w-4 bg-white/20'
          }`} />
        ))}
      </div>

      <div className="w-full max-w-sm">
        {steps[step]}
      </div>
    </div>
  )
}
