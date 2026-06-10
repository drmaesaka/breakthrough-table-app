'use client'
import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
    })
    if (error) { setError(error.message); setLoading(false) }
    else { setSent(true); setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-bt-pale flex flex-col">
      <div className="bg-bt-navy pt-16 pb-14 px-6 flex flex-col items-center">
        <div className="bg-white rounded-2xl px-5 py-3"><Image src="/bt-logo.png" alt="Breakthrough Table" width={200} height={70} className="object-contain" /></div>
      </div>

      <div className="flex-1 px-5 -mt-6 pb-10">
        <div className="bg-white rounded-2xl shadow-lg p-6">
          {sent ? (
            <div className="text-center py-4">
              <p className="text-4xl mb-3">📬</p>
              <h2 className="text-xl font-bold text-bt-navy mb-2">Check your email</h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                We sent a reset link to <span className="font-semibold text-gray-600">{email}</span>. Tap it to set a new password.
              </p>
              <Link href="/login" className="block mt-6 text-bt-blue font-semibold text-sm">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-bt-navy mb-1">Reset password</h2>
              <p className="text-gray-400 text-sm mb-6">We'll send you a link to reset it.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue text-base"
                    placeholder="you@example.com" required />
                </div>
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full bg-bt-navy text-white py-4 rounded-xl font-semibold text-base disabled:opacity-50">
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
              <p className="text-center text-sm text-gray-400 mt-6">
                <Link href="/login" className="text-bt-blue font-semibold">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
