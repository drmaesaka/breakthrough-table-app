// The short quote under members' Home tiles (2026-10-10). One a day, the
// same for everyone, from public-domain writers the programme already leans
// on (As a Man Thinketh is on the reading list). Add to the list freely.
const QUOTES: { text: string; by: string }[] = [
  { text: 'Circumstance does not make the man; it reveals him to himself.', by: 'James Allen' },
  { text: 'Dreams are the seedlings of realities.', by: 'James Allen' },
  { text: 'The soul attracts that which it secretly harbours.', by: 'James Allen' },
  { text: 'Waste no more time arguing what a good man should be. Be one.', by: 'Marcus Aurelius' },
  { text: 'The happiness of your life depends upon the quality of your thoughts.', by: 'Marcus Aurelius' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', by: 'Seneca' },
  { text: 'Well done is better than well said.', by: 'Benjamin Franklin' },
  { text: 'Self-trust is the first secret of success.', by: 'Ralph Waldo Emerson' },
]

export function quoteOfTheDay(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000)
  return QUOTES[day % QUOTES.length]
}
