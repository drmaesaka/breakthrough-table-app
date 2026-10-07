import { redirect } from 'next/navigation'

// Reflections were removed 2026-10-07 ("gets confusing"). Old links and
// notifications land on Home. Prompts and answers are still in the
// database (journal_prompts, journal_responses) if this ever comes back.
export default function JournalPage() {
  redirect('/dashboard')
}
