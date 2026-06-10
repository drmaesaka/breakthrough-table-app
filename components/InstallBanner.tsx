'use client'
import { useEffect, useState } from 'react'

export default function InstallBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Only show on iOS Safari
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    // Check if already running as installed PWA
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true
    // Check if user already dismissed
    const dismissed = localStorage.getItem('install_banner_dismissed')

    if (isIOS && !isInstalled && !dismissed) {
      setShow(true)
    }
  }, [])

  function dismiss() {
    localStorage.setItem('install_banner_dismissed', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="mx-5 mb-4 bg-bt-navy rounded-2xl p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">📲</span>
          <div>
            <p className="text-white font-bold text-sm">Add to Home Screen</p>
            <p className="text-bt-light/70 text-xs mt-1 leading-relaxed">
              To get nudge notifications, tap{' '}
              <span className="text-bt-light font-semibold">Share</span>
              {' '}then{' '}
              <span className="text-bt-light font-semibold">"Add to Home Screen"</span>
              {' '}in Safari.
            </p>
          </div>
        </div>
        <button onClick={dismiss} className="text-bt-light/50 hover:text-white flex-shrink-0 mt-0.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
