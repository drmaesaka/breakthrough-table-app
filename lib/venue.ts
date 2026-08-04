// Slot arithmetic for room booking, shared by the booking page, the admin rooms
// tab and the /api/bookings route.
//
// It lives in one file because the same rules have to hold in three places: the
// grid a member taps, the grid a leader taps, and the server that decides
// whether to write the row. When the grid and the server disagree the member
// sees an open slot that the API then rejects, which is the shape of bug this
// app has been chasing all along.
//
// Everything here works in minutes-since-midnight. Times cross the wire as
// Postgres `time` values, which arrive as 'HH:MM:SS' but are often written
// 'HH:MM' by hand, so parsing tolerates both.

export type VenueHours = {
  day_of_week: number
  open_time: string
  close_time: string
  is_closed: boolean
}

export type VenueSettings = {
  slot_minutes: number
  min_duration_minutes: number
  max_duration_minutes: number
  booking_horizon_days: number
  max_active_bookings_per_member: number | null
  max_minutes_per_member_per_day: number | null
}

export type Interval = { start: number; end: number }

/** Fallback used only when venue_settings has not been read yet. */
export const DEFAULT_SETTINGS: VenueSettings = {
  slot_minutes: 30,
  min_duration_minutes: 30,
  max_duration_minutes: 240,
  booking_horizon_days: 60,
  max_active_bookings_per_member: null,
  max_minutes_per_member_per_day: null,
}

/** 'HH:MM' or 'HH:MM:SS' to minutes since midnight. */
export function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** Minutes since midnight to the 'HH:MM' form Postgres accepts for `time`. */
export function toTimeString(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Minutes since midnight to a human label, e.g. 570 to '9:30 AM'. */
export function formatTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

/** '90' to '1h 30m'. Used on duration buttons. */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (!h) return `${m}m`
  if (!m) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * Weekday index (0 = Sunday) for a YYYY-MM-DD string.
 *
 * Parsed at noon deliberately. `new Date('2026-08-03')` is parsed as UTC
 * midnight, which is the previous evening in Central and reports the wrong
 * weekday — the same class of bug lib/dates.ts exists to prevent.
 */
export function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDay()
}

export function hoursForDate(hours: VenueHours[], dateStr: string): VenueHours | null {
  const dow = dayOfWeek(dateStr)
  return hours.find(h => h.day_of_week === dow) || null
}

/**
 * Every start time bookable on `dateStr`, as minutes since midnight.
 *
 * Slots step by slot_minutes from opening. The last one is early enough that
 * the shortest allowed booking still finishes by closing time — offering a
 * start that cannot fit any booking is just a button that always errors.
 */
export function slotsForDate(
  hours: VenueHours[],
  settings: VenueSettings,
  dateStr: string
): number[] {
  const day = hoursForDate(hours, dateStr)
  if (!day || day.is_closed) return []

  const open = parseTime(day.open_time)
  const close = parseTime(day.close_time)
  const latestStart = close - settings.min_duration_minutes

  const out: number[] = []
  for (let t = open; t <= latestStart; t += settings.slot_minutes) out.push(t)
  return out
}

/** Bookings for one room and date as sorted, comparable intervals. */
export function toIntervals(
  bookings: { start_time: string; end_time: string }[]
): Interval[] {
  return bookings
    .map(b => ({ start: parseTime(b.start_time), end: parseTime(b.end_time) }))
    .sort((a, b) => a.start - b.start)
}

/** Half-open overlap: a booking ending at 10:00 does not clash with one starting at 10:00. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

export function isFree(start: number, end: number, taken: Interval[]): boolean {
  return !taken.some(t => overlaps({ start, end }, t))
}

/**
 * The longest booking that can start at `start`: capped by closing time, by the
 * next existing booking, and by max_duration_minutes. Returns 0 when the slot
 * is already taken or nothing valid fits.
 *
 * This is what lets the UI grey out "2 hours" on a slot with only 90 minutes of
 * room ahead of it, rather than accepting the tap and failing server-side.
 */
export function maxDurationAt(
  start: number,
  taken: Interval[],
  hours: VenueHours[],
  settings: VenueSettings,
  dateStr: string
): number {
  const day = hoursForDate(hours, dateStr)
  if (!day || day.is_closed) return 0
  if (!isFree(start, start + settings.min_duration_minutes, taken)) return 0

  const close = parseTime(day.close_time)
  const nextBooking = taken.filter(t => t.start >= start).map(t => t.start).sort((a, b) => a - b)[0]
  const ceiling = Math.min(close, nextBooking ?? close, start + settings.max_duration_minutes)

  const available = ceiling - start
  if (available < settings.min_duration_minutes) return 0

  // Round down to the grid so the returned figure is actually bookable.
  return Math.floor(available / settings.slot_minutes) * settings.slot_minutes
}

/** Selectable durations, shortest first — multiples of the grid within bounds. */
export function durationOptions(settings: VenueSettings): number[] {
  const out: number[] = []
  const step = settings.slot_minutes
  const first = Math.ceil(settings.min_duration_minutes / step) * step
  for (let d = Math.max(step, first); d <= settings.max_duration_minutes; d += step) out.push(d)
  return out
}

/**
 * Why a booking cannot be made, or null if it can. Shared so the button's
 * disabled state and the API's rejection give the same answer for the same
 * reason.
 *
 * `nowMinutes` is only consulted when the booking is for today; pass it as null
 * to skip the past-slot check (the admin booking-on-behalf flow does).
 */
export function validateBooking(opts: {
  start: number
  duration: number
  taken: Interval[]
  hours: VenueHours[]
  settings: VenueSettings
  dateStr: string
  today: string
  nowMinutes: number | null
}): string | null {
  const { start, duration, taken, hours, settings, dateStr, today, nowMinutes } = opts
  const day = hoursForDate(hours, dateStr)

  if (dateStr < today) return 'That date has already passed.'
  if (!day || day.is_closed) return 'The venue is closed that day.'

  const horizon = addDays(today, settings.booking_horizon_days)
  if (dateStr > horizon) {
    return `Bookings open ${settings.booking_horizon_days} days ahead.`
  }

  const open = parseTime(day.open_time)
  const close = parseTime(day.close_time)
  const end = start + duration

  if (start < open || end > close) {
    return `That runs outside opening hours (${formatTime(open)}–${formatTime(close)}).`
  }
  if ((start - open) % settings.slot_minutes !== 0) return 'That is not a valid start time.'
  if (duration % settings.slot_minutes !== 0) return 'That is not a valid length.'
  if (duration < settings.min_duration_minutes) {
    return `Bookings are at least ${formatDuration(settings.min_duration_minutes)}.`
  }
  if (duration > settings.max_duration_minutes) {
    return `Bookings are at most ${formatDuration(settings.max_duration_minutes)}.`
  }
  if (dateStr === today && nowMinutes !== null && start < nowMinutes) {
    return 'That time has already passed today.'
  }
  if (!isFree(start, end, taken)) return 'That overlaps a booking already on the calendar.'

  return null
}

/** YYYY-MM-DD plus n days, staying on local calendar days. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

/** Minutes since local midnight, for the past-slot check. */
export function nowMinutes(date: Date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes()
}
