import type { ReactNode } from 'react'

// Turns bare URLs in a run of text into tappable links. Reading & Resources
// items have no link field — a TC pastes the URL into the description — and
// members could not tap it (Table 32, 2026-09-21).
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"])/gi

export function linkify(text: string | null | undefined, className = 'underline text-bt-blue'): ReactNode {
  if (!text) return null
  const parts = text.split(URL_RE)
  return parts.map((part, i) => {
    if (i % 2 === 0) return part
    const href = part.startsWith('http') ? part : `https://${part}`
    return (
      <a key={i} href={href} target="_blank" rel="noopener noreferrer" className={className}
        onClick={e => e.stopPropagation()}>
        {part}
      </a>
    )
  })
}

export function hasLink(text: string | null | undefined): boolean {
  return Boolean(text && new RegExp(URL_RE.source, 'i').test(text))
}
