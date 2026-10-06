/**
 * "Thu, Oct 9 · 6:00 – 8:00 PM", or just the start when there is no end.
 * `timeZone` is for the server (emails); the browser uses the viewer's own.
 */
export function eventWhen(start: string, end?: string | null, timeZone?: string): string {
  const s = new Date(start)
  const day = s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone })
  const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
  if (!end) return `${day} · ${t(s)}`
  return `${day} · ${t(s)} – ${t(new Date(end))}`
}

/** The end instant from the start's local date plus an "HH:MM" end time. null if blank. */
export function endFromTime(startLocal: string, endTime: string): Date | null {
  if (!endTime) return null
  const day = startLocal.slice(0, 10)
  const d = new Date(`${day}T${endTime}`)
  return isNaN(d.getTime()) ? null : d
}
