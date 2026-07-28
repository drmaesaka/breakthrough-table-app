// Calendar days in this app are the member's local days, not UTC days.
//
// `new Date().toISOString().split('T')[0]` returns the UTC date, which for a
// Central member rolls over at 7pm local (6pm in winter). A habit checked off
// at 8pm Monday was therefore stored against Tuesday: Tuesday morning showed
// as already complete, Monday never got a row at all, and streaks counted the
// wrong days.

/** The local calendar day as YYYY-MM-DD. */
export function localDay(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA')
}

/** The calendar day as YYYY-MM-DD in a specific IANA timezone. */
export function dayInTimezone(timezone: string, date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date)
  } catch {
    return localDay(date)
  }
}
