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

  // Habit state
  const [currentHabit, setCurrentHabit] = useState('')
  const [habitInput, setHabitInput] = useState('')
  const [habitSaving, setHabitSaving] = useState(false)
  const [habitSaved, setHabitSaved] = useState(false)
  const [graduatedHabits, setGraduatedHabits] = useState<any[]>([])
  const [graduating, setGraduating] = useState(false)
  const [showGradHistory, setShowGradHistory] = useState(false)
  const [userId, setUserId] = useState('')

  // Directory state
  const [directoryOptIn, setDirectoryOptIn] = useState(false)
  const [bio, setBio] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [dirSaving, setDirSaving] = useState(false)
  const [dirSaved, setDirSaved] = useState(false)

  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setEmail(user.email || '')
      setUserId(user.id)

      const [{ data: prof }, { data: history }] = await Promise.all([
        supabase.from('profiles').select('*, groups(name)').eq('id', user.id).single(),
        supabase.from('habit_history').select('*').eq('user_id', user.id).order('graduated_at', { ascending: false }),
      ])

      if (prof) {
        setProfile(prof)
        setName(prof.full_name || '')
        setCurrentHabit(prof.current_habit || '')
        setHabitInput(prof.current_habit || '')
        setDirectoryOptIn(prof.directory_opt_in || false)
        setBio(prof.bio || '')
        setLinkedinUrl(prof.linkedin_url || '')
        setContactEmail(prof.contact_email || '')
      }
      setGraduatedHabits(history || [])
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

  async function saveHabit() {
    if (!habitInput.trim()) return
    setHabitSaving(true)
    const supabase = createClient()
    await supabase.from('profiles').update({ current_habit: habitInput.trim() }).eq('id', userId)
    setCurrentHabit(habitInput.trim())
    setHabitSaving(false)
    setHabitSaved(true)
    setTimeout(() => setHabitSaved(false), 2500)
  }

  async function graduateHabit() {
    if (!currentHabit) return
    setGraduating(true)
    const supabase = createClient()

    // Archive to history
    await supabase.from('habit_history').insert({
      user_id: userId,
      habit_name: currentHabit,
      graduated_at: new Date().toISOString(),
    })

    // Clear current habit
    await supabase.from('profiles').update({ current_habit: null }).eq('id', userId)

    // Refresh history
    const { data: history } = await supabase
      .from('habit_history').select('*').eq('user_id', userId).order('graduated_at', { ascending: false })

    setGraduatedHabits(history || [])
    setCurrentHabit('')
    setHabitInput('')
    setGraduating(false)
  }

  async function saveDirectory() {
    setDirSaving(true)
    const supabase = createClient()
    await supabase.from('profiles').update({
      directory_opt_in: directoryOptIn,
      bio: bio.trim(),
      linkedin_url: linkedinUrl.trim(),
      contact_email: contactEmail.trim(),
    }).eq('id', userId)
    setDirSaving(false)
    setDirSaved(true)
    setTimeout(() => setDirSaved(false), 2500)
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function getInitials(n: string) {
    const parts = (n || '').trim().split(' ')
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : n.slice(0, 2).toUpperCase() || '?'
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
          <div className="flex gap-2 mt-2 flex-wrap justify-center">
            {profile?.groups?.name && (
              <span className="text-xs bg-white/15 text-bt-light px-3 py-1 rounded-full">{profile.groups.name}</span>
            )}
            {profile?.role === 'leader' && (
              <span className="text-xs bg-white/15 text-bt-light px-3 py-1 rounded-full">Leader</span>
            )}
            {graduatedHabits.length > 0 && (
              <span className="text-xs bg-white/15 text-bt-light px-3 py-1 rounded-full">
                🏅 {graduatedHabits.length} habit{graduatedHabits.length !== 1 ? 's' : ''} installed
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">

        {/* Current Habit */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-bt-navy">Current Habit</h3>
              <p className="text-gray-400 text-xs mt-0.5">What you're actively building</p>
            </div>
            <span className="text-2xl">🎯</span>
          </div>
          <input
            value={habitInput}
            onChange={e => setHabitInput(e.target.value)}
            placeholder="e.g. Morning cold plunge, Daily journaling..."
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
          />
          <button onClick={saveHabit} disabled={habitSaving || !habitInput.trim() || habitInput.trim() === currentHabit}
            className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
            {habitSaving ? 'Saving...' : habitSaved ? '✓ Saved!' : currentHabit ? 'Update Habit' : 'Set Habit'}
          </button>
          {currentHabit && (
            <button onClick={graduateHabit} disabled={graduating}
              className="w-full bg-green-50 text-green-700 border-2 border-green-200 py-3 rounded-xl font-semibold text-sm disabled:opacity-50">
              {graduating ? 'Graduating...' : '🏅 I\'ve fully installed this habit'}
            </button>
          )}
        </div>

        {/* Graduated Habits */}
        {graduatedHabits.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <button
              onClick={() => setShowGradHistory(!showGradHistory)}
              className="w-full flex items-center justify-between">
              <div>
                <h3 className="font-bold text-bt-navy">Installed Habits</h3>
                <p className="text-gray-400 text-xs mt-0.5">{graduatedHabits.length} habit{graduatedHabits.length !== 1 ? 's' : ''} fully built</p>
              </div>
              <span className="text-gray-400 text-lg">{showGradHistory ? '▲' : '▼'}</span>
            </button>
            {showGradHistory && (
              <div className="mt-3 space-y-2">
                {graduatedHabits.map((h: any) => (
                  <div key={h.id} className="flex items-center gap-3 px-3 py-2.5 bg-bt-pale rounded-xl">
                    <span className="text-lg">🏅</span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">{h.habit_name}</p>
                      <p className="text-xs text-gray-400">Installed {formatDate(h.graduated_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-bt-navy mb-3">This Period</h3>
          <div className="flex gap-3">
            <div className="flex-1 text-center bg-bt-pale rounded-xl py-3">
              <p className="text-2xl font-bold text-bt-navy">{profile?.adherence_percent || 0}%</p>
              <p className="text-gray-400 text-xs mt-0.5">Adherence</p>
            </div>
            <div className="flex-1 text-center bg-bt-pale rounded-xl py-3">
              <p className="text-2xl font-bold text-bt-navy">{profile?.streak || 0}🔥</p>
              <p className="text-gray-400 text-xs mt-0.5">Streak</p>
            </div>
            <div className="flex-1 text-center bg-bt-pale rounded-xl py-3">
              <p className="text-lg font-bold text-bt-navy capitalize">{profile?.role || 'member'}</p>
              <p className="text-gray-400 text-xs mt-0.5">Role</p>
            </div>
          </div>
        </div>

        {/* Member Directory */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-bt-navy">Member Directory</h3>
              <p className="text-gray-400 text-xs mt-0.5">Let other BT members find you</p>
            </div>
            <button
              onClick={() => setDirectoryOptIn(!directoryOptIn)}
              className={`relative w-12 h-6 rounded-full transition-colors ${directoryOptIn ? 'bg-bt-navy' : 'bg-gray-200'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${directoryOptIn ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          {directoryOptIn && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">Bio — what do you do? what are you building?</label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  placeholder="e.g. Entrepreneur building a fitness brand in Austin. 3 years in..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">LinkedIn URL (optional)</label>
                <input
                  value={linkedinUrl}
                  onChange={e => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/yourname"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">Contact Email (optional)</label>
                <input
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue"
                />
              </div>
            </>
          )}
          <button onClick={saveDirectory} disabled={dirSaving}
            className="w-full bg-bt-navy text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40">
            {dirSaving ? 'Saving...' : dirSaved ? '✓ Saved!' : 'Save Directory Settings'}
          </button>
        </div>

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
