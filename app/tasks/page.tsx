import { redirect } from 'next/navigation'

// Tasks merged into My Table (2026-10-05). Old links, bookmarks and the
// URLs in notifications already sent still land in the right place.
export default function TasksPage() {
  redirect('/group')
}
