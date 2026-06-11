'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

const TONES = [
  { value: 'encouraging', label: '🙌 Encouraging', desc: "Warm, positive, you've got this energy" },
  { value: 'direct', label: '⚡ Direct', desc: 'Short, no-fluff, get it done' },
  { value: 'gentle', label: '🌱 Gentle', desc: 'Soft reminders, no pressure' },
  { value: 'competitive', label: '🔥 Competitive', desc: 'Push harder, beat your streak' },
]

const TIME_OPTIONS = [
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30',
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
  '21:00', '21:30', '22:00', '22:30',
]

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`
}

export default function PreferencesPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [frequency, setFrequency] = useState(1)
  const [nudgeTimes, setNudgeTimes] = useState(['09:00'])
  const [tone, setTone] = useState('encouraging')
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: prefs } = await supabase
        .from('nudge_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (prefs) {
        setEnabled(prefs.enabled)
        setFrequency(prefs.frequency)
        setNudgeTimes(prefs.nudge_times || ['09:00'])
        setTone(prefs.tone)
      }
      setLoading(false)
    }
    load()
  }, [router])

  // Keep nudgeTimes array in sync with frequency
  function handleFrequencyChange(f: number) {
    setFrequency(f)
    const current = [...nudgeTimes]
    const defaults = ['07:00', '09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '20:00', '21:00', '22:00']
    if (f > current.length) {
      while (current.length < f) current.push(defaults[current.length] || '12:00')
    } else {
      current.splice(f)
    }
    setNudgeTimes(current)
  }

  function nudgeLabel(i: number, total: number) {
    if (total === 1) return 'Time'
    const labels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']
    return labels[i] || `#${i + 1}`
  }

  function handleTimeChange(index: number, value: string) {
    const updated = [...nudgeTimes]
    updated[index] = value
    setNudgeTimes(updated)
  }

  async function save() {
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    await supabase.from('nudge_preferences').upsert({
      user_id: user.id,
      enabled,
      frequency,
      nudge_times: nudgeTimes,
      tone,
      timezone,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return (
    <div className="min-h-screen bg-bt-pale flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-bt-pale">
      {/* Header */}
      <div className="bg-bt-navy px-5 pt-16 pb-5">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-bt-light/70 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-white text-2xl font-bold">Nudge Settings</h1>
            <p className="text-bt-light/60 text-sm mt-0.5">Customize how we check in with you</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">

        {/* Master toggle */}
        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900">Push Notifications</p>
            <p className="text-gray-400 text-xs mt-0.5">{enabled ? 'Nudges are on' : 'All nudges paused'}</p>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${enabled ? 'bg-bt-blue' : 'bg-gray-200'}`}>
            <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        {enabled && (
          <>
            {/* Frequency */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-bt-navy">How often?</h3>
                  <p className="text-gray-400 text-xs mt-0.5">Number of nudges per day</p>
                </div>
                <span className="text-2xl font-bold text-bt-navy">{frequency}x</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={frequency}
                onChange={e => handleFrequencyChange(Number(e.target.value))}
                className="w-full accent-bt-navy h-2 rounded-full cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>1</span>
                <span>5</span>
                <span>10</span>
              </div>
            </div>

            {/* Times */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <div>
                <h3 className="font-bold text-bt-navy">When?</h3>
                <p className="text-gray-400 text-xs mt-0.5">Pick your preferred nudge times</p>
              </div>
              {nudgeTimes.map((t, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-gray-400 text-sm w-8">
                    {nudgeLabel(i, nudgeTimes.length)}
                  </span>
                  <select
                    value={t}
                    onChange={e => handleTimeChange(i, e.target.value)}
                    className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue bg-white">
                    {TIME_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{formatTime(opt)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Tone */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <div>
                <h3 className="font-bold text-bt-navy">What's your style?</h3>
                <p className="text-gray-400 text-xs mt-0.5">Tone of your nudge messages</p>
              </div>
              <div className="space-y-2">
                {TONES.map(t => (
                  <button key={t.value} onClick={() => setTone(t.value)}
                    className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                      tone === t.value
                        ? 'border-bt-blue bg-bt-pale'
                        : 'border-gray-100 bg-white'
                    }`}>
                    <p className={`font-semibold text-sm ${tone === t.value ? 'text-bt-navy' : 'text-gray-700'}`}>
                      {t.label}
                    </p>
                    <p className="text-gray-400 text-xs mt-0.5">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Save button */}
        <button onClick={save} disabled={saving}
          className="w-full bg-bt-navy text-white py-4 rounded-2xl font-semibold text-base disabled:opacity-50 transition-opacity">
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Preferences'}
        </button>

      </div>
      <BottomNav />
    </div>
  )
}
