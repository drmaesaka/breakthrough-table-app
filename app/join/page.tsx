'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase'
import PasswordInput from '@/components/PasswordInput'

function JoinForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [inviteExpired, setInviteExpired] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  // ?invite=<code> is the revocable format; ?group=<id> is the legacy one that
  // the server only honors until the invite migration runs.
  const invite = searchParams.get('invite')
  const legacyGroup = searchParams.get('group')

  useEffect(() => {
    if (!invite && !legacyGroup) return
    async function fetchGroup() {
      const params = invite ? `invite=${invite}` : `group=${legacyGroup}`
      const res = await fetch(`/api/join?${params}`)
      if (!res.ok) { setInviteExpired(true); return }
      const data = await res.json()
      if (data.group_name) setGroupName(data.group_name)
    }
    fetchGroup()
  }, [invite, legacyGroup])

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }
    })

    if (signupError) {
      setError(signupError.message)
      setLoading(false)
      return
    }

    // Seat the member at their table. The server validates the invite and
    // writes group_id with the service key — the browser cannot write it
    // directly, which is what used to let anyone join any table by id.
    if ((invite || legacyGroup) && data.session) {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ invite, group: legacyGroup }),
      })
      if (!res.ok) {
        const { error: joinError } = await res.json().catch(() => ({ error: null }))
        // The account exists — let them continue, but say the seat didn't take
        // so they know to ask their leader instead of assuming they're in.
        alert(joinError
          ? `Your account was created, but joining the table failed: ${joinError}`
          : 'Your account was created, but joining the table failed. Ask your leader to add you from the Admin panel.')
      }
    }

    router.push('/onboarding')
  }

  return (
    <div className="min-h-screen bg-bt-pale flex flex-col">
      <div className="bg-bt-navy pt-16 pb-14 px-6 flex flex-col items-center">
        <div className="bg-white rounded-2xl px-5 py-3"><Image src="/bt-logo.png" alt="Breakthrough Table" width={200} height={70} className="object-contain" /></div>
        {groupName && (
          <div className="mt-5 bg-white/15 rounded-xl px-4 py-2 text-center">
            <p className="text-bt-light/70 text-xs">You're joining</p>
            <p className="text-white font-bold text-base mt-0.5">{groupName}</p>
          </div>
        )}
        {inviteExpired && (
          <div className="mt-5 bg-red-500/20 rounded-xl px-4 py-2 text-center">
            <p className="text-white text-sm font-medium">This invite link is no longer valid</p>
            <p className="text-bt-light/70 text-xs mt-0.5">Ask your leader for a fresh one</p>
          </div>
        )}
      </div>

      <div className="flex-1 px-5 -mt-6 pb-10">
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-xl font-bold text-bt-navy mb-1">Create your account</h2>
          <p className="text-gray-400 text-sm mb-6">
            {groupName ? `Join ${groupName} on Breakthrough Table` : 'Join your Breakthrough Table group'}
          </p>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue text-base"
                placeholder="Your name" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue text-base"
                placeholder="you@example.com" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-bt-navy text-white py-4 rounded-xl font-semibold text-base disabled:opacity-50 mt-2">
              {loading ? 'Creating account...' : 'Join Now'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-6">
            Already have an account?{' '}
            <Link href="/login" className="text-bt-blue font-semibold">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function JoinPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bt-pale flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>}>
      <JoinForm />
    </Suspense>
  )
}
