'use client'
import { useState } from 'react'

// One password box for every screen that has one — login, signup, join and
// reset. Table leaders asked for a way to see what they typed: on a phone
// keyboard a mistyped password is invisible, and the only recourse was the
// reset-email loop.
//
// The toggle is a button, not a checkbox, so it sits inside the box and the
// row stays one line on a narrow phone. type="button" keeps it from submitting
// the form it lives in.

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: 'current-password' | 'new-password'
  required?: boolean
}

export default function PasswordInput({
  value, onChange, placeholder = '••••••••', autoComplete, required = true,
}: Props) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full pl-4 pr-16 py-3.5 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue text-base"
      />
      <button
        type="button"
        onClick={() => setShown(s => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-bt-blue px-1 py-1">
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
