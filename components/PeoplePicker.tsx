'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import Avatar from '@/components/Avatar'

export type Person = { id: string; full_name: string; avatar_url: string | null; table: string | null }

// Pick people from anywhere in BT — the point of custom group chats is
// three people at three different tables. Searchable, grouped by table.
export default function PeoplePicker({ exclude = [], selected, onChange }: {
  exclude?: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await createClient().auth.getSession()
      const res = await fetch('/api/rooms/people', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
      const json = await res.json().catch(() => ({ people: [] }))
      setPeople(json.people || [])
    })()
  }, [])

  const shown = useMemo(() => {
    const ex = new Set(exclude)
    const needle = q.trim().toLowerCase()
    return (people || []).filter(p => !ex.has(p.id) && (!needle || p.full_name.toLowerCase().includes(needle) || (p.table || '').toLowerCase().includes(needle)))
  }, [people, q, exclude])

  if (!people) return <p className="text-xs text-gray-400">Loading people...</p>

  return (
    <div className="space-y-2">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or table"
        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue" />
      {selected.size > 0 && (
        <p className="text-xs text-bt-navy font-semibold">{selected.size} selected</p>
      )}
      <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
        {shown.length === 0 && <p className="text-xs text-gray-400 py-2">Nobody matches.</p>}
        {shown.map(p => {
          const on = selected.has(p.id)
          return (
            <button key={p.id} type="button"
              onClick={() => { const n = new Set(selected); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); onChange(n) }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left ${on ? 'bg-bt-navy text-white' : 'bg-white text-gray-800'}`}>
              <Avatar src={p.avatar_url} name={p.full_name} className={`w-8 h-8 ${on ? 'bg-white/20' : 'bg-bt-pale'}`} textClass={`${on ? 'text-white' : 'text-bt-navy'} font-bold text-xs`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.full_name}</p>
                <p className={`text-xs truncate ${on ? 'text-white/70' : 'text-gray-400'}`}>{p.table || 'No table'}</p>
              </div>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${on ? 'bg-white text-bt-navy' : 'border border-gray-300'}`}>{on ? '✓' : ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
