// One avatar for every place a member's face or initials appears.
// A photo when they have uploaded one (profiles.avatar_url), initials
// otherwise — the exact fallback each screen drew by hand before 2026-09-03.
// Size and colours stay with the caller via className/textClass so the chat
// bubbles, directory cards and profile header keep their own proportions.

type Props = {
  src?: string | null
  name?: string | null
  /** Size, background and border — e.g. "w-7 h-7 bg-bt-pale border border-gray-200". */
  className: string
  /** Initials colour and size — e.g. "text-bt-navy font-bold text-xs". */
  textClass: string
}

export function initialsOf(name?: string | null) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return (parts[0] || '').slice(0, 2).toUpperCase() || '?'
}

export default function Avatar({ src, name, className, textClass }: Props) {
  return (
    <div className={`rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name || ''} className="w-full h-full object-cover" />
      ) : (
        <span className={textClass}>{initialsOf(name)}</span>
      )}
    </div>
  )
}
