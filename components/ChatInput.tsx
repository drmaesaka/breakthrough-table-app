'use client'
import { useLayoutEffect, useRef } from 'react'

/**
 * The message box in every chat (2026-10-09): wraps and grows like a text
 * message, up to about six lines, then scrolls. Return adds a new line on a
 * phone (the send button sends); on a computer Return sends and
 * Shift+Return adds a line.
 */
export default function ChatInput({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Fit the box to its text on every change.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
        if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
          e.preventDefault()
          e.currentTarget.form?.requestSubmit()
        }
      }}
      placeholder={placeholder}
      className="flex-1 min-w-0 bg-bt-pale rounded-2xl px-4 py-2.5 text-sm leading-snug text-gray-900 resize-none overflow-y-auto focus:outline-none focus:ring-2 focus:ring-bt-blue"
    />
  )
}
