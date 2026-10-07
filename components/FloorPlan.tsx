'use client'

// Floor plans of the two suites, so members can see which room they are
// booking (2026-10-07; drawn from the venue's Skedda map, which members were
// used to). Each space on the plan is matched to an app room by name, so a
// room renamed in Admin → Rooms keeps working as long as the name still
// contains the space's name ("Proctor", "Proctor Conference Room", ...).
// A space with no matching app room is drawn grey: it is on the plan but not
// bookable here (Wattles and Robbins are assigned private offices).

type Space = { key: string; label: string; kind: string; shape: string; labelAt: [number, number] }
type Plan = { suite: string; viewBox: string; outline: string; walls: string[]; spaces: Space[] }

const PLANS: Plan[] = [
  {
    suite: '145',
    viewBox: '0 190 800 770',
    outline: '22,207 530,207 530,280 668,280 668,440 M668,500 668,605 780,605 780,855 330,855 240,945 22,945 22,207',
    walls: ['M323,207 L323,855', 'M22,420 L323,420', 'M22,632 L323,632', 'M497,605 L497,855', 'M497,605 L668,605'],
    spaces: [
      { key: 'wattles', label: 'Wattles', kind: 'Private office', shape: '22,207 323,207 323,420 22,420', labelAt: [172, 300] },
      { key: 'proctor', label: 'Proctor', kind: 'Conference room', shape: '22,632 323,632 323,855 240,945 22,945', labelAt: [172, 770] },
      { key: 'rohn', label: 'Rohn', kind: 'Conference room', shape: '497,605 780,605 780,855 497,855', labelAt: [638, 730] },
    ],
  },
  {
    suite: '120',
    viewBox: '0 280 800 590',
    outline: '85,298 752,298 752,657 778,657 778,730 717,730 717,855 M660,855 493,855 493,728 392,728 392,660 22,660 22,375 85,298',
    walls: ['M246,298 L246,660', 'M381,298 L381,577', 'M246,577 L381,577', 'M545,298 L545,577', 'M431,577 L545,577'],
    spaces: [
      { key: 'hill', label: 'Hill', kind: 'Conference room', shape: '85,298 246,298 246,660 22,660 22,375', labelAt: [134, 470] },
      { key: 'robbins', label: 'Robbins', kind: 'Private office', shape: '246,298 381,298 381,577 246,577', labelAt: [313, 440] },
      { key: 'brown', label: 'Brown', kind: 'Private office', shape: '381,298 545,298 545,577 381,577', labelAt: [463, 440] },
    ],
  },
]

export function planForSuite(suite: string | null | undefined): Plan | null {
  const digits = (suite || '').match(/\d+/)?.[0]
  return PLANS.find(p => p.suite === digits) || null
}

/** The app room drawn as this space, if any. */
function roomFor<T extends { name: string }>(space: Space, rooms: T[]): T | null {
  return rooms.find(r => r.name.toLowerCase().includes(space.key)) || null
}

export default function FloorPlan<T extends { id: string; name: string }>({ suite, rooms, status, selectedId, onPick }: {
  suite: string
  rooms: T[]
  /** 'open' = at least one slot left on the chosen day. */
  status: (room: T) => 'open' | 'full'
  selectedId: string | null
  onPick: (room: T) => void
}) {
  const plan = planForSuite(suite)
  if (!plan) return null
  return (
    <div className="bg-white rounded-2xl shadow-sm p-3">
      <svg viewBox={plan.viewBox} className="w-full h-auto" role="img" aria-label={`Floor plan of ${suite}`}>
        {plan.spaces.map(space => {
          const room = roomFor(space, rooms)
          const st = room ? status(room) : null
          const picked = room && room.id === selectedId
          const fill = picked ? '#1F3A68' : st === 'open' ? '#DCFCE7' : st === 'full' ? '#FEE2E2' : '#F1F5F9'
          const text = picked ? '#FFFFFF' : st ? '#0F172A' : '#94A3B8'
          return (
            <g key={space.key} onClick={() => room && onPick(room)} style={{ cursor: room ? 'pointer' : 'default' }}
              role={room ? 'button' : undefined} aria-label={room ? `${space.label}, ${space.kind}, ${st === 'open' ? 'open' : 'fully booked'}` : undefined}>
              <polygon points={space.shape} fill={fill} stroke={picked ? '#1F3A68' : '#CBD5E1'} strokeWidth={picked ? 6 : 2} />
              <text x={space.labelAt[0]} y={space.labelAt[1]} textAnchor="middle" fontSize="26" fontWeight="700" fill={text}>{space.label.toUpperCase()}</text>
              <text x={space.labelAt[0]} y={space.labelAt[1] + 30} textAnchor="middle" fontSize="19" fill={text}>
                {room ? (picked ? 'Selected' : st === 'open' ? 'Open' : 'Fully booked') : space.kind}
              </text>
            </g>
          )
        })}
        {plan.walls.map((d, i) => <path key={i} d={d} stroke="#94A3B8" strokeWidth="4" strokeDasharray="12 10" fill="none" pointerEvents="none" />)}
        {plan.outline.split(' M').map((seg, i) => (
          <polyline key={i} points={seg.replace(/^M/, '').replace(/ /g, ' ')} fill="none" stroke="#64748B" strokeWidth="10" strokeLinejoin="round" pointerEvents="none" />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-500 px-1">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-200 mr-1 align-middle" />Open</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-200 mr-1 align-middle" />Fully booked</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-200 mr-1 align-middle" />Not bookable here</span>
        <span className="text-gray-400">Tap a room to book it.</span>
      </div>
    </div>
  )
}
