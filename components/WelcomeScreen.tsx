'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'

interface Props {
  userId: string
  firstName: string
}

export default function WelcomeScreen({ userId, firstName }: Props) {
  const [visible, setVisible] = useState(false)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const key = `bt_welcomed_${userId}`
    if (!localStorage.getItem(key)) {
      setVisible(true)
      // Auto-dismiss after 3.5s
      const timer = setTimeout(() => dismiss(), 3500)
      return () => clearTimeout(timer)
    }
  }, [userId])

  function dismiss() {
    setFading(true)
    setTimeout(() => {
      localStorage.setItem(`bt_welcomed_${userId}`, '1')
      setVisible(false)
    }, 600)
  }

  if (!visible) return null

  return (
    <div
      onClick={dismiss}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center cursor-pointer select-none"
      style={{
        backgroundColor: '#0f2044',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.6s ease',
      }}
    >
      {/* Logo */}
      <div className="mb-12 bg-white rounded-2xl px-5 py-3">
        <Image src="/bt-logo.png" alt="Breakthrough Table" width={160} height={56} className="object-contain" />
      </div>

      {/* Name */}
      <h1
        className="text-white font-bold text-center px-8"
        style={{ fontSize: '3rem', lineHeight: 1.1 }}
      >
        Welcome to your table,<br />{firstName}.
      </h1>

      {/* Tagline */}
      <p className="text-white/50 text-base mt-6 tracking-wide text-center px-10">
        Accountability starts here.
      </p>

      {/* Tap hint */}
      <p className="absolute bottom-14 text-white/30 text-sm tracking-widest uppercase">
        Tap to continue
      </p>
    </div>
  )
}
