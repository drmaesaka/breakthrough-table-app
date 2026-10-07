// The table a TC is "working in", shared by every screen (2026-10-07).
// Shown and switched in the bar above the bottom tabs (components/BottomNav);
// My Table and Admin follow it. Kept in this device's localStorage: it is a
// per-person convenience, and a fresh device simply starts at their own table.

const KEY = 'bt.currentTable'
const EVENT = 'bt-current-table'

export function getCurrentTable(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function setCurrentTable(id: string) {
  try { localStorage.setItem(KEY, id) } catch { /* private mode: this screen still switches */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }))
}

/** Calls back when the table is switched from anywhere. Returns the unsubscribe. */
export function onCurrentTableChange(cb: (id: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/** The stored table if it is one of `ids`, else the first of `fallbacks` that is. */
export function pickTable(ids: string[], ...fallbacks: (string | null | undefined)[]): string | null {
  const stored = getCurrentTable()
  if (stored && ids.includes(stored)) return stored
  for (const f of fallbacks) if (f && ids.includes(f)) return f
  return ids[0] ?? null
}
