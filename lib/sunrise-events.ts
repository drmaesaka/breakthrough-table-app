// Sunrise Network events on the app's Events page (2026-10-09), the same way
// Library shows Sunrise content: read from Cause Machine's read-only API, so
// nobody enters an event twice. Tickets and registration stay on Sunrise
// (or the Eventbrite page it links to); the app shows the event and links out.
//
// Only Published + Public events still to come. Private ones are invitation
// lists on Sunrise and are left out.
//
// SERVER ONLY: uses the Cause Machine credentials.

import { fetchEvents, fetchEventOverview, type CauseMachineEvent } from './cause-machine'
import { htmlToText } from './sunrise-library'

export type SunriseEvent = {
  id: string
  title: string
  tagline: string | null
  start: string
  end: string | null
  location: string | null
  description: string
  /** The event's page on Sunrise: details and tickets. */
  url: string | null
  image: string | null
}

// Ten minutes: events change rarely, and each one costs a detail request.
let cache: { at: number; events: SunriseEvent[] } | null = null
const CACHE_MS = 10 * 60 * 1000

function where(e: CauseMachineEvent): string | null {
  const v = e.Venue
  if (!v) return null
  const a = v.Address
  const street = [a?.AddressLine1, a?.AddressLine2].filter(Boolean).join(', ')
  const place = [street, a?.City].filter(Boolean).join(', ')
  return [v.Name, place].filter(Boolean).join(' · ') || null
}

export async function upcomingSunriseEvents(): Promise<SunriseEvent[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.events
  const now = Date.now()
  const upcoming = (await fetchEvents())
    .filter(e => e.Status === 'Published' && e.Privacy === 'Public' && e.StartDate)
    .filter(e => new Date(e.EndDate || e.StartDate!).getTime() >= now)
    .sort((a, b) => a.StartDate!.localeCompare(b.StartDate!))
    .slice(0, 25)
  const overviews = await Promise.all(upcoming.map(e => fetchEventOverview(e.EventId).catch(() => null)))
  const events = upcoming.map((e, i) => ({
    id: `sunrise-${e.EventId}`,
    title: (e.Name || 'Event').trim(),
    tagline: e.Tagline?.trim() || null,
    start: e.StartDate!,
    end: e.EndDate || null,
    location: where(e),
    description: htmlToText(overviews[i]),
    url: e.Communities?.find(c => c.EventUrl)?.EventUrl || null,
    image: e.BannerImageUrl || e.LogoImageUrl || null,
  }))
  cache = { at: Date.now(), events }
  return events
}
