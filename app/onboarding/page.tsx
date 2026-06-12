'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Image from 'next/image'

export default function OnboardingPage() {
  const [firstName, setFirstName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [memberCount, setMemberCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  useEffect(() => {
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

  async function finish() {
    setSaving(true)
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
        onClick={finish}
        disabled={saving}
        className="w-full max-w-xs bg-white text-bt-navy py-4 rounded-2xl font-bold text-base disabled:opacity-50">
        {saving ? 'One moment...' : "Let's go →"}
      </button>
    </div>
  )
}
