'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase'

function JoinForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupId, setGroupId] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const gid = searchParams.get('group')
    if (!gid) return
    setGroupId(gid)
    async function fetchGroup() {
      const supabase = createClient()
      const { data } = await supabase.from('groups').select('name').eq('id', gid).single()
      if (data) setGroupName(data.name)
    }
    fetchGroup()
  }, [searchParams])

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

    // Assign to group if invite link had a group ID
    if (groupId && data.user) {
      await supabase
        .from('profiles')
        .update({ group_id: groupId })
        .eq('id', data.user.id)
    }

    router.push('/dashboard')
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
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue text-base"
                placeholder="••••••••" required />
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
