'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setEmail(user.email || '')

      const { data: prof } = await supabase
        .from('profiles')
        .select('*, groups(name)')
        .eq('id', user.id)
        .single()

      if (prof) {
        setProfile(prof)
        setName(prof.full_name || '')
      }
      setLoading(false)
    }
    load()
  }, [router])

  async function saveName() {
    if (!name.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', user.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function getInitials(n: string) {
    return n?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      <div className="bg-bt-navy px-5 pt-16 pb-10">
        <div className="flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-bt-blue flex items-center justify-center mb-3">
            <span className="text-white text-2xl font-bold">{getInitials(name)}</span>
          </div>
          <h1 className="text-white text-2xl font-bold">{name || 'Your Name'}</h1>
          <p className="text-bt-light/60 text-sm mt-0.5">{email}</p>
          {profile?.groups?.name && (
            <span className="mt-2 text-xs bg-white/15 text-bt-light px-3 py-1 rounded-full">
              {profile.groups.name}
            </span>
          )}
          {profile?.role === 'leader' && (
            <span className="mt-2 text-xs bg-white/15 text-bt-light px-3 py-1 rounded-full">
              Leader
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">

        {/* Edit name */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <h3 className="font-bold text-bt-navy">Edit Name</h3>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your full name"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
          />
          <button onClick={saveName} disabled={saving || !name.trim()}
            className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Name'}
          </button>
        </div>

        {/* Stats */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-bt-navy mb-3">This Period</h3>
          <div className="flex gap-4">
            <div className="flex-1 text-center bg-bt-pale rounded-xl py-3">
              <p className="text-2xl font-bold text-bt-navy">{profile?.adherence_percent || 0}%</p>
              <p className="text-gray-400 text-xs mt-0.5">Adherence</p>
            </div>
            <div className="flex-1 text-center bg-bt-pale rounded-xl py-3">
              <p className="text-2xl font-bold text-bt-navy capitalize">{profile?.role || 'member'}</p>
              <p className="text-gray-400 text-xs mt-0.5">Role</p>
            </div>
          </div>
        </div>

        {/* Sign out */}
        <button onClick={handleLogout}
          className="w-full bg-white text-red-400 py-4 rounded-2xl font-semibold text-sm shadow-sm border border-red-100">
          Sign Out
        </button>

      </div>
      <BottomNav />
    </div>
  )
}
