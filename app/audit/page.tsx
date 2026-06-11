'use client'
import { useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase'

const QUESTIONS = [
  { id: 1, text: "I have a clear, specific picture of what I want the next chapter of my life to look like.", dim: 'clarity', reverse: false },
  { id: 2, text: "Most days I know exactly what I should be focused on, and why.", dim: 'clarity', reverse: false },
  { id: 3, text: "I feel pulled in too many directions to make real progress on what matters.", dim: 'clarity', reverse: true },
  { id: 4, text: "Who I am is bigger than my job title or what I do for work.", dim: 'identity', reverse: false },
  { id: 5, text: "If my current role disappeared tomorrow, I'd still have a strong sense of who I am.", dim: 'identity', reverse: false },
  { id: 6, text: "Lately I've wondered who I really am outside of my work or the roles I play.", dim: 'identity', reverse: true },
  { id: 7, text: "I trust my own judgment, even on the big decisions.", dim: 'inner_game', reverse: false },
  { id: 8, text: "Self-doubt or a quiet \"am I good enough?\" rarely holds me back.", dim: 'inner_game', reverse: false },
  { id: 9, text: "When things go quiet, negative self-talk tends to creep in.", dim: 'inner_game', reverse: true },
  { id: 10, text: "I consistently finish the personal goals and projects I start.", dim: 'execution', reverse: false },
  { id: 11, text: "I have reliable systems that keep me accountable to what I say matters.", dim: 'execution', reverse: false },
  { id: 12, text: "I start things with energy, but they lose steam and don't get finished.", dim: 'execution', reverse: true },
  { id: 13, text: "I have a circle of peers who genuinely challenge me and hold me accountable.", dim: 'community', reverse: false },
  { id: 14, text: "When I'm wrestling with something big, I have the right people to think it through with.", dim: 'community', reverse: false },
  { id: 15, text: "I'm mostly figuring out my growth on my own.", dim: 'community', reverse: true },
]

const ARCHETYPES: Record<string, { name: string; headline: string; body: string; color: string }> = {
  clarity: {
    name: "The Crossroads",
    headline: "Your path isn't clear yet — and that's exactly the right problem to solve.",
    body: "You're more than capable — the direction just hasn't locked in. When everything's a priority, nothing moves. What helps: getting deliberate about a vision and purpose before chasing the next goal. BT's purpose and values work is built for exactly this moment.",
    color: '#5B9BD5',
  },
  identity: {
    name: "The Title Trap",
    headline: "So much of who you are got fused to what you do.",
    body: "A shift is shaking that loose — and that's not a crisis, it's an invitation. What helps: rebuilding a sense of self that the next role can stand on. This is the most common result for our audience, and the most transformative to work through.",
    color: '#7C6FCD',
  },
  inner_game: {
    name: "The Quiet Doubter",
    headline: "On paper you've proven yourself. The self-doubt still taxes every big move.",
    body: "What helps: surfacing the paradigms running quietly in the background and challenging them — ideally with people who reflect you back honestly. The inner game is where the biggest shifts happen.",
    color: '#E07B4A',
  },
  execution: {
    name: "The Starter",
    headline: "You're full of ideas and good intentions. Follow-through is where it slips.",
    body: "Willpower isn't the fix — structure and accountability are. What helps: a consistent cadence and a group that makes finishing the default, not the exception.",
    color: '#22c55e',
  },
  community: {
    name: "The Lone Wolf",
    headline: "You've gotten here largely on your own — which is exactly why the next level feels heavy.",
    body: "What helps: a small circle of people who get it, challenge you, and hold you to your word. This is the thing our members say changed everything — not content, not curriculum. The right people in the room.",
    color: '#f59e0b',
  },
}

const OVERALL_BANDS = [
  { min: 60, max: 75, label: "Aligned & Building", desc: "Mostly clear — the work now is sharpening and surrounding yourself with the right people." },
  { min: 45, max: 59, label: "Capable but Scattered", desc: "Strong foundation, real friction in one or two areas." },
  { min: 30, max: 44, label: "Stuck at the Threshold", desc: "You sense more is possible but can't quite get traction." },
  { min: 15, max: 29, label: "At an Inflection Point", desc: "You're in a real transition — this is the moment to do the inner work intentionally." },
]

const LABELS = ['', 'Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree']

type Phase = 'intro' | 'questions' | 'email_gate' | 'results'

export default function AuditPage() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [email, setEmail] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [results, setResults] = useState<any>(null)
  const [selected, setSelected] = useState<number | null>(null)

  function calcResults(ans: Record<number, number>) {
    const dims: Record<string, number> = { clarity: 0, identity: 0, inner_game: 0, execution: 0, community: 0 }
    QUESTIONS.forEach(q => {
      const raw = ans[q.id] || 3
      const score = q.reverse ? (6 - raw) : raw
      dims[q.dim] += score
    })
    const overall = Object.values(dims).reduce((a, b) => a + b, 0)
    const lowestDim = Object.entries(dims).sort((a, b) => a[1] - b[1])[0][0]
    const band = OVERALL_BANDS.find(b => overall >= b.min && overall <= b.max) || OVERALL_BANDS[2]
    return { dims, overall, archetype: lowestDim, band }
  }

  function handleAnswer(val: number) {
    setSelected(val)
    setTimeout(() => {
      const newAnswers = { ...answers, [QUESTIONS[current].id]: val }
      setAnswers(newAnswers)
      setSelected(null)
      if (current < QUESTIONS.length - 1) {
        setCurrent(current + 1)
      } else {
        const r = calcResults(newAnswers)
        setResults(r)
        setPhase('email_gate')
      }
    }, 300)
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setEmailError('Email is required'); return }
    setEmailSaving(true)
    setEmailError('')

    try {
      const supabase = createClient()
      await supabase.from('audit_responses').insert({
        email: email.trim(),
        scores: results.dims,
        archetype: results.archetype,
        overall_score: results.overall,
        dim_clarity: results.dims.clarity,
        dim_identity: results.dims.identity,
        dim_inner_game: results.dims.inner_game,
        dim_execution: results.dims.execution,
        dim_community: results.dims.community,
      })
    } catch (e) { /* non-blocking */ }

    setEmailSaving(false)
    setPhase('results')
  }

  const progress = Math.round((current / QUESTIONS.length) * 100)
  const archetype = results ? ARCHETYPES[results.archetype] : null
  const band = results?.band

  // INTRO
  if (phase === 'intro') return (
    <div className="min-h-screen bg-bt-navy flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg">
        <div className="flex justify-center mb-10">
          <div className="bg-white rounded-2xl px-5 py-3">
            <Image src="/bt-logo.png" alt="Breakthrough Table" width={180} height={63} className="object-contain" />
          </div>
        </div>
        <h1 className="text-white text-3xl font-bold text-center leading-tight mb-4">
          The Breakthrough Audit
        </h1>
        <p className="text-bt-light/70 text-center text-base leading-relaxed mb-6">
          Where are you stuck? A 10-minute snapshot for high-achievers in transition.
        </p>
        <div className="bg-white/10 rounded-2xl p-6 mb-8 space-y-3">
          <p className="text-white/90 text-sm leading-relaxed">
            You've built the career. Hit the milestones. And somewhere along the way, a quiet question showed up:
          </p>
          <p className="text-white font-semibold text-base italic leading-relaxed">
            "Is this it — and who am I outside of it?"
          </p>
          <p className="text-white/70 text-sm leading-relaxed">
            You're not lost. You're at the gap between who you've been and who's next. This 10-minute audit shows you exactly where you're stuck — and what actually helps.
          </p>
        </div>
        <div className="flex items-center gap-4 text-bt-light/50 text-xs justify-center mb-8">
          <span>15 questions</span>
          <span>·</span>
          <span>~10 minutes</span>
          <span>·</span>
          <span>No login required</span>
        </div>
        <button onClick={() => setPhase('questions')}
          className="w-full bg-white text-bt-navy py-4 rounded-2xl font-bold text-base">
          Start the Audit →
        </button>
        <p className="text-bt-light/40 text-xs text-center mt-4">Be honest — it only works if you are.</p>
      </div>
    </div>
  )

  // QUESTIONS
  if (phase === 'questions') {
    const q = QUESTIONS[current]
    return (
      <div className="min-h-screen bg-bt-navy flex flex-col px-6 py-12">
        <div className="w-full max-w-lg mx-auto flex-1 flex flex-col">
          {/* Progress */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-bt-light/50 text-xs">{current + 1} of {QUESTIONS.length}</span>
              <span className="text-bt-light/50 text-xs">{progress}%</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Question */}
          <div className="flex-1 flex flex-col justify-center">
            <p className="text-white text-xl font-semibold leading-relaxed mb-10 text-center">
              {q.text}
            </p>

            {/* Answer buttons */}
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(val => (
                <button
                  key={val}
                  onClick={() => handleAnswer(val)}
                  className={`w-full py-4 px-5 rounded-2xl text-left font-medium transition-all duration-200 flex items-center gap-4 ${
                    selected === val
                      ? 'bg-white text-bt-navy scale-[0.98]'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}>
                  <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                    selected === val ? 'border-bt-navy text-bt-navy' : 'border-white/30 text-white/50'
                  }`}>{val}</span>
                  <span className="text-sm">{LABELS[val]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Back button */}
          {current > 0 && (
            <button onClick={() => setCurrent(current - 1)}
              className="mt-8 text-bt-light/40 text-sm text-center">
              ← Back
            </button>
          )}
        </div>
      </div>
    )
  }

  // EMAIL GATE
  if (phase === 'email_gate' && results) {
    const teaser = OVERALL_BANDS.find(b => results.overall >= b.min && results.overall <= b.max)
    return (
      <div className="min-h-screen bg-bt-navy flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <p className="text-5xl mb-4">✅</p>
            <h2 className="text-white text-2xl font-bold mb-2">Your audit is ready.</h2>
            <p className="text-bt-light/60 text-sm leading-relaxed">
              You scored in the <span className="text-white font-semibold">"{teaser?.label}"</span> range.
            </p>
            <p className="text-bt-light/50 text-sm mt-2 leading-relaxed">
              Enter your email to unlock your full Breakthrough Snapshot — your scores across all 5 dimensions and a personalized read on where you're stuck.
            </p>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-4 rounded-2xl bg-white/10 border border-white/20 text-white placeholder-white/30 focus:outline-none focus:border-white/50 text-base"
              required
            />
            {emailError && <p className="text-red-400 text-sm">{emailError}</p>}
            <button type="submit" disabled={emailSaving}
              className="w-full bg-white text-bt-navy py-4 rounded-2xl font-bold text-base disabled:opacity-50">
              {emailSaving ? 'One moment...' : 'Unlock My Snapshot →'}
            </button>
          </form>
          <p className="text-bt-light/30 text-xs text-center mt-4">No spam. You'll get your results + one short follow-up.</p>
        </div>
      </div>
    )
  }

  // RESULTS
  if (phase === 'results' && results && archetype && band) {
    const dimLabels: Record<string, string> = {
      clarity: 'Clarity & Direction',
      identity: 'Identity & Alignment',
      inner_game: 'Inner Game',
      execution: 'Execution & Accountability',
      community: 'Community & Support',
    }
    return (
      <div className="min-h-screen bg-bt-pale">
        {/* Header */}
        <div className="bg-bt-navy px-6 pt-16 pb-10 flex flex-col items-center text-center">
          <div className="bg-white rounded-2xl px-5 py-3 mb-6">
            <Image src="/bt-logo.png" alt="Breakthrough Table" width={160} height={56} className="object-contain" />
          </div>
          <p className="text-bt-light/60 text-sm uppercase tracking-widest mb-2">Your Breakthrough Snapshot</p>
          <h1 className="text-white text-3xl font-bold mb-1">{archetype.name}</h1>
          <p className="text-bt-light/70 text-sm mt-1">{band.label}</p>
        </div>

        <div className="px-5 py-6 space-y-5 max-w-lg mx-auto pb-16">

          {/* Archetype card */}
          <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ borderLeft: `4px solid ${archetype.color}` }}>
            <p className="font-bold text-gray-900 text-base leading-snug mb-2">{archetype.headline}</p>
            <p className="text-gray-500 text-sm leading-relaxed">{archetype.body}</p>
          </div>

          {/* Dimension scores */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-bt-navy mb-4">Your 5 Dimensions</h3>
            <div className="space-y-3">
              {Object.entries(results.dims).map(([dim, score]: [string, any]) => {
                const pct = Math.round(((score - 3) / 12) * 100)
                const isLowest = dim === results.archetype
                return (
                  <div key={dim}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-semibold ${isLowest ? 'text-bt-navy' : 'text-gray-500'}`}>
                        {dimLabels[dim]}{isLowest ? ' ← your focus area' : ''}
                      </span>
                      <span className="text-xs text-gray-400">{score}/15</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.max(pct, 4)}%`,
                          backgroundColor: isLowest ? archetype.color : '#94a3b8'
                        }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Overall band */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-bt-navy">Overall Score</h3>
              <span className="text-2xl font-bold text-bt-navy">{results.overall}<span className="text-gray-300 text-base font-normal">/75</span></span>
            </div>
            <p className="text-gray-500 text-sm">{band.desc}</p>
          </div>

          {/* CTA */}
          <div className="bg-bt-navy rounded-2xl p-6 text-center">
            <p className="text-white font-bold text-lg mb-2">Want to go deeper on this?</p>
            <p className="text-bt-light/60 text-sm leading-relaxed mb-5">
              Breakthrough Table is a small group of peers who challenge each other, track real commitments, and do the inner work together. No content dumps. No sales pitches. Just the right people in the room.
            </p>
            <a href="https://breakthroughtable.com" target="_blank" rel="noopener noreferrer"
              className="block w-full bg-white text-bt-navy py-4 rounded-xl font-bold text-base mb-3">
              Join a Free Virtual Table Taster →
            </a>
            <a href="/signup"
              className="block text-bt-light/50 text-sm">
              Already a member? Sign in →
            </a>
          </div>

          <p className="text-gray-400 text-xs text-center leading-relaxed">
            This might not be the right season — and that's completely okay. The door's open whenever it is.
          </p>
        </div>
      </div>
    )
  }

  return null
}
