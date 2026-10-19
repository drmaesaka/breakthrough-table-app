'use client'
import { useLayoutEffect, useRef, useState } from 'react'
import Avatar from '@/components/Avatar'
import type { MentionPerson } from '@/lib/mentions'

/**
 * The message box in every chat (2026-10-09): wraps and grows like a text
 * message, up to about six lines, then scrolls. Return adds a new line on a
 * phone (the send button sends); on a computer Return sends and
 * Shift+Return adds a line — unless `enterSends` is off (Follow-ups posts).
 *
 * `people` turns on @mentions (2026-10-19): typing "@" lists the people in
 * the chat; tapping one writes "@Full Name ".
 */
export default function ChatInput({ value, onChange, placeholder, people, enterSends = true, className }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  people?: MentionPerson[]
  enterSends?: boolean
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)

  // Fit the box to its text on every change.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  // "@par" right before the cursor → suggestions matching "par".
  const typed = value.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,30})$/)
  const query = typed ? typed[1].toLowerCase() : null
  const matches = query === null || !people?.length ? [] : people
    .filter(p => p.full_name.toLowerCase().split(/\s+/).some(w => w.startsWith(query)) || p.full_name.toLowerCase().startsWith(query))
    .slice(0, 6)

  function pick(p: MentionPerson) {
    const start = caret - (typed![1].length + 1)
    const next = value.slice(0, start) + '@' + p.full_name + ' ' + value.slice(caret)
    onChange(next)
    const pos = start + p.full_name.length + 2
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); setCaret(pos) })
  }

  return (
    <div className="relative flex-1 min-w-0">
      {matches.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-2xl shadow-lg border border-gray-100 py-1 z-30 max-h-60 overflow-y-auto">
          {matches.map(p => (
            <button key={p.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left active:bg-bt-pale">
              <Avatar src={p.avatar_url} name={p.full_name} className="w-7 h-7 bg-bt-pale" textClass="text-bt-navy font-bold text-[10px]" />
              <span className="text-sm text-gray-900">{p.full_name}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={e => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length) }}
        onSelect={e => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={e => {
          if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(matches[0]); return }
          const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
          if (enterSends && e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
        placeholder={placeholder}
        className={className || 'w-full bg-bt-pale rounded-2xl px-4 py-2.5 text-sm leading-snug text-gray-900 resize-none overflow-y-auto focus:outline-none focus:ring-2 focus:ring-bt-blue block'}
      />
    </div>
  )
}
