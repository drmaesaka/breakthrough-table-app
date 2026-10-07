'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

// TC tools for Sunrise content in Library (see lib/sunrise-library.ts):
// pairing a table with its Sunrise group, and pasting links for videos the
// app cannot play yet. One fetch shared by every card on the screen.

type Data = { groups: { id: string; name: string }[]; unlinked: { id: string; title: string | null; sunriseUrl: string | null }[] }
let shared: Promise<Data> | null = null

async function headers(): Promise<Record<string, string>> {
  const { data: { session } } = await createClient().auth.getSession()
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` }
}

function useSunriseData(): Data | null {
  const [data, setData] = useState<Data | null>(null)
  useEffect(() => {
    if (!shared) shared = (async () => {
      const res = await fetch('/api/admin/sunrise', { headers: await headers() }).catch(() => null)
      return res && res.ok ? res.json() : { groups: [], unlinked: [] }
    })()
    shared.then(setData)
  }, [])
  return data
}

/** On a table card: which Sunrise group's posts this table sees in Library. */
export function SunriseGroupPicker({ tableId, value, onSaved }: { tableId: string; value: string | null; onSaved: (v: string | null) => void }) {
  const data = useSunriseData()
  if (!data || !data.groups.length) return null
  return (
    <label className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
      <span className="font-medium whitespace-nowrap">Sunrise group</span>
      <select value={value || ''}
        onChange={async e => {
          const v = e.target.value || null
          const res = await fetch('/api/admin/edit-item', { method: 'PATCH', headers: await headers(),
            body: JSON.stringify({ table: 'groups', id: tableId, fields: { sunrise_group_id: v } }) })
          if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || 'Could not save'); return }
          onSaved(v)
        }}
        className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white">
        <option value="">None — only BT-wide posts</option>
        {data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </label>
  )
}

/** In Admin → content: Sunrise videos with no playable link, and a box to paste one. */
export function SunriseVideoLinks() {
  const data = useSunriseData()
  const [done, setDone] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [err, setErr] = useState<Record<string, string>>({})
  if (!data) return null
  const left = data.unlinked.filter(v => !done.has(v.id))
  if (!left.length) return null
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
      <div>
        <h3 className="font-bold text-bt-navy">Sunrise videos to link ({left.length})</h3>
        <p className="text-gray-400 text-xs mt-0.5">These are in Library but can&apos;t play in the app yet. Open each on Sunrise, copy the YouTube or Loom link, and paste it here.</p>
      </div>
      {left.map(v => (
        <div key={v.id} className="space-y-1.5 border-t border-gray-100 pt-3">
          <p className="text-sm font-semibold text-gray-900">{v.title || 'Untitled'}</p>
          {v.sunriseUrl && <a href={v.sunriseUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-bt-blue">Open on Sunrise ↗</a>}
          <div className="flex gap-2">
            <input value={drafts[v.id] || ''} onChange={e => setDrafts(d => ({ ...d, [v.id]: e.target.value }))} placeholder="https://youtu.be/…"
              className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bt-blue" />
            <button disabled={!drafts[v.id]?.trim()}
              onClick={async () => {
                const res = await fetch('/api/admin/sunrise', { method: 'POST', headers: await headers(), body: JSON.stringify({ resource_id: v.id, url: drafts[v.id] }) })
                const j = await res.json().catch(() => ({}))
                if (!res.ok) { setErr(e => ({ ...e, [v.id]: j.error || 'Could not save' })); return }
                setDone(s => new Set(s).add(v.id))
              }}
              className="px-4 rounded-xl bg-bt-navy text-white text-sm font-semibold disabled:opacity-40">Save</button>
          </div>
          {err[v.id] && <p className="text-xs text-red-600">{err[v.id]}</p>}
        </div>
      ))}
    </div>
  )
}
