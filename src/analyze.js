// @ts-check
// Counting: what each reply cost, how much of it was re-reading history, and when the whole history had to be
// written again.
import path from 'node:path'
import { isInside } from './files.js'
import { findingsOf } from './findings.js'
import { dayOf, pct, round1, round2 } from './format.js'
import { contextOf, costOf, priceOf } from './prices.js'
import { DISPLAY_ORDER, toolOf, TOOLS } from './tools.js'

/** @typedef {import('./prices.js').Call} Call */
/** @typedef {'cold' | 'model' | 'prefix'} Reason */

/** @typedef {import('./tools.js').Tool} Tool */

/**
 * The tools in words: 'Claude Code', 'Codex', 'Claude Code and Codex'.
 * @param {Tool[]} tools
 */
export function productOf(tools) {
  const names = DISPLAY_ORDER.filter((t) => tools.includes(t)).map((t) => TOOLS[t].name)
  if (names.length < 2) return names[0] ?? TOOLS.claude.name
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Why the whole history was written again: the cache went cold, the model changed, or something early changed. */
export const REASONS = /** @type {const} */ (['cold', 'model', 'prefix'])

/** How each reply is marked in the report's session chart. */
export const FLAG = { none: 0, cold: 1, model: 2, prefix: 3, shrink: 4 }

/** A compaction counts when the context it replaced was at least this large. */
const COMPACT_MIN = 20e3
/** Below this the API caches nothing, so a small context is never a rebuild. */
const CACHE_MIN = 2048
/** A reply is "long context" from here. */
export const LONG_CONTEXT = 150e3

/** Context sizes for the "cost by context size" chart: [upper bound, label]. */
export const BUCKETS = /** @type {const} */ ([
  [50e3, '0–50k'],
  [100e3, '50–100k'],
  [150e3, '100–150k'],
  [200e3, '150–200k'],
  [500e3, '200–500k'],
  [Infinity, '500k+'],
])

/**
 * @typedef {object} Totals
 * @property {number} calls
 * @property {number} cost         API price of everything, US dollars
 * @property {number} readCost     of which cache reads
 * @property {number} rebuildCost  of which history written again after the cache was lost
 * @property {number} tokensIn
 * @property {number} tokensRead
 * @property {number} peak         largest context
 * @property {number} longCost     cost of replies with a context over LONG_CONTEXT
 * @property {Record<Reason, { n: number, cost: number }>} rebuilds
 * @property {{ n: number, ctx: number }} compact  compactions, and the sum of the contexts they replaced
 * @property {number} [first]
 * @property {number} [last]
 */

/** @returns {Totals} */
export const emptyTotals = () => ({
  calls: 0,
  cost: 0,
  readCost: 0,
  rebuildCost: 0,
  tokensIn: 0,
  tokensRead: 0,
  peak: 0,
  longCost: 0,
  rebuilds: { cold: { n: 0, cost: 0 }, model: { n: 0, cost: 0 }, prefix: { n: 0, cost: 0 } },
  compact: { n: 0, ctx: 0 },
})

/**
 * Add b into a.
 * @template {Totals} T
 * @param {T} a
 * @param {Totals} b
 * @returns {T}
 */
export function addTotals(a, b) {
  a.calls += b.calls
  a.cost += b.cost
  a.readCost += b.readCost
  a.rebuildCost += b.rebuildCost
  a.tokensIn += b.tokensIn
  a.tokensRead += b.tokensRead
  a.longCost += b.longCost
  a.peak = Math.max(a.peak, b.peak)
  for (const w of REASONS) {
    a.rebuilds[w].n += b.rebuilds[w].n
    a.rebuilds[w].cost += b.rebuilds[w].cost
  }
  a.compact.n += b.compact.n
  a.compact.ctx += b.compact.ctx
  if (b.first !== undefined) a.first = Math.min(a.first ?? Infinity, b.first)
  if (b.last !== undefined) a.last = Math.max(a.last ?? 0, b.last)
  return a
}

/**
 * @typedef {object} Step  what one counted reply cost and what happened
 * @property {number} ctx
 * @property {number} cost
 * @property {number} readCost
 * @property {number} rebuildCost
 * @property {Reason | null} why  set when the whole history was written again
 * @property {number} flag        FLAG value for the report
 */

/**
 * Walk one stream of replies (a session file, or a subagent inside one) in time order.
 *
 * A reply is a rebuild when its cache read fell below half of the previous reply's context while the context did not
 * shrink: the history the previous reply had cached was written again. The reason is `model` when the model changed,
 * `cold` when the gap was longer than the cache's life (5 minutes, or 1 hour once a 1-hour write was seen), and
 * otherwise `prefix` (something early in the context changed). A context that shrank below 60% is a compaction or
 * /clear, not a rebuild.
 *
 * Replies marked `seen` were counted in an earlier file: they set the cache state but are not counted again.
 * @param {Call[]} calls
 * @param {(c: Call, step: Step) => void} [onCall]  called for every counted reply
 * @returns {Totals & { ttl: number, lastCall: Call | null }}
 */
export function walk(calls, onCall = () => {}) {
  const s = emptyTotals()
  /** @type {Call | null} */
  let prev = null
  let ttl = 300e3
  for (const c of calls) {
    if (c.seen) {
      prev = c
      continue
    }
    const ctx = contextOf(c)
    const p = priceOf(c.model, ctx)
    const cost = costOf(c)
    const readCost = (c.read * p.read) / 1e6
    /** @type {Reason | null} */
    let why = null
    let rebuildCost = 0
    let shrank = false
    if (prev) {
      const before = contextOf(prev)
      shrank = ctx < before * 0.6
      if (shrank && before >= COMPACT_MIN) {
        s.compact.n++
        s.compact.ctx += before
      }
      if (!shrank && before >= CACHE_MIN && c.read < before * 0.5) {
        const written = Math.max(0, Math.min(before, ctx) - c.read)
        const rate = c.cw1 > 0 ? p.write1h : c.cw5 > 0 ? p.write5m : p.input
        why = c.model !== prev.model ? 'model' : c.ts - prev.ts > ttl ? 'cold' : 'prefix'
        rebuildCost = (written * rate) / 1e6
        s.rebuilds[why].n++
        s.rebuilds[why].cost += rebuildCost
      }
    }
    s.calls++
    s.cost += cost
    s.readCost += readCost
    s.rebuildCost += rebuildCost
    s.tokensIn += ctx
    s.tokensRead += c.read
    s.peak = Math.max(s.peak, ctx)
    if (ctx > LONG_CONTEXT) s.longCost += cost
    s.first ??= c.ts
    s.last = c.ts
    onCall(c, { ctx, cost, readCost, rebuildCost, why, flag: why ? FLAG[why] : shrank ? FLAG.shrink : FLAG.none })
    if (c.cw1 > 0) ttl = 3600e3
    else if (c.cw5 > 0) ttl = 300e3
    prev = c
  }
  return { ...s, ttl, lastCall: prev }
}

/**
 * @typedef {Totals & { id: string, tool: Tool, project: string, branch: string, points: [number, number, number, number][] }} Session
 *   points: [time, context, cache read, FLAG] for each reply, for the report's chart
 * @typedef {{ calls: number, usd: number, readUsd: number, rebuildUsd: number }} Money
 */

/**
 * Read and count session files.
 * @param {string[]} files  in the order sessionFiles() gives
 * @param {{ since: number, project?: string, folders?: string[], onProgress?: (done: number, total: number) => void }} opts
 *   folders: only sessions that ran in one of these folders or a folder inside one.
 *   A file that cannot be read (removed meanwhile, no permission, a broken archive) is skipped and listed in `skipped`.
 */
export function analyze(files, { since, project = '', folders = [], onProgress }) {
  const needle = project.toLowerCase()
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {Map<string, Session>} */
  const sessions = new Map()
  const total = emptyTotals()
  /** @type {Map<string, Money>} */
  const daily = new Map()
  /** @type {Map<string, Money>} */
  const models = new Map()
  /** @type {Map<string, Money>} */
  const buckets = new Map()
  const zero = () => ({ calls: 0, usd: 0, readUsd: 0, rebuildUsd: 0 })
  /**
   * @param {Map<string, Money>} map
   * @param {string} key
   * @param {Step} x
   */
  const tally = (map, key, x) => {
    const v = map.get(key) ?? zero()
    v.calls++
    v.usd += x.cost
    v.readUsd += x.readCost
    v.rebuildUsd += x.rebuildCost
    map.set(key, v)
  }

  /** @type {{ file: string, error: string }[]} */
  const skipped = []

  files.forEach((file, i) => {
    onProgress?.(i + 1, files.length)
    const tool = toolOf(file)
    if (!tool) return
    /** @type {import('./tools.js').Read} */
    let read
    try {
      read = TOOLS[tool].read(file, since, seen)
    } catch (err) {
      skipped.push({ file, error: /** @type {Error} */ (err).message })
      return
    }
    const { id, sub, cwd, branch, calls } = read
    if (!calls.some((c) => !c.seen)) return
    const info = /** @type {import('./tools.js').ToolInfo} */ (TOOLS[tool])
    if (!info.projectInPath && needle) {
      if (!cwd.toLowerCase().includes(needle)) return
    }
    // A file with no folder in it (a subagent's) was already chosen by its path, where the path holds the project.
    if (folders.length && !(cwd ? folders.some((f) => isInside(cwd, f)) : info.projectInPath)) return
    const cur = sessions.get(id) ?? { id, tool, project: '', branch: '', points: [], ...emptyTotals() }
    const s = walk(calls, (c, x) => {
      tally(daily, dayOf(c.ts), x)
      tally(models, c.model, x)
      const label = /** @type {(typeof BUCKETS)[number]} */ (BUCKETS.find(([top]) => x.ctx < top))[1]
      tally(buckets, label, x)
      if (!sub) cur.points.push([c.ts, x.ctx, c.read, x.flag])
    })
    if (cwd && !cur.project) cur.project = path.basename(cwd)
    if (branch && !cur.branch) cur.branch = branch
    sessions.set(id, addTotals(cur, s))
    addTotals(total, s)
  })

  return { total, sessions: [...sessions.values()].sort((a, b) => b.cost - a.cost), daily, models, buckets, skipped }
}

/**
 * @typedef {ReturnType<typeof analyze>} Analysis
 * @typedef {ReturnType<typeof summarize>} Report
 */

/**
 * The numbers every output shows, as plain data (what --json prints).
 * @param {Analysis} a
 * @param {{ span: string, anon: boolean, version: string, now?: Date }} opts
 */
export function summarize(a, { span, anon, version, now = new Date() }) {
  const { total, sessions: list } = a

  /** @type {Map<string, { project: string, sessions: number, calls: number, cost: number, reread: number }>} */
  const projectMap = new Map()
  for (const s of list) {
    const name = s.project || '(unknown)'
    const p = projectMap.get(name) ?? { project: name, sessions: 0, calls: 0, cost: 0, reread: 0 }
    p.sessions++
    p.calls += s.calls
    p.cost += s.cost
    p.reread += s.readCost + s.rebuildCost
    projectMap.set(name, p)
  }
  const projects = [...projectMap.values()].sort((a, b) => b.cost - a.cost)
  // --anon: one name per project, in order of cost, used everywhere.
  const alias = new Map(projects.map((p, i) => [p.project, anon ? `project ${i + 1}` : p.project]))
  const nameOf = (/** @type {string} */ project) => alias.get(project || '(unknown)') ?? ''

  const share = pct(total.readCost + total.rebuildCost, total.cost)
  const rb = total.rebuilds

  /** @type {Map<Tool, { sessions: number, calls: number, cost: number, reread: number }>} */
  const toolMap = new Map()
  for (const s of list) {
    const t = toolMap.get(s.tool) ?? { sessions: 0, calls: 0, cost: 0, reread: 0 }
    t.sessions++
    t.calls += s.calls
    t.cost += s.cost
    t.reread += s.readCost + s.rebuildCost
    toolMap.set(s.tool, t)
  }
  const tools = [...toolMap].sort((x, y) => y[1].cost - x[1].cost)
  const product = productOf([...toolMap.keys()])

  /** @type {{ day: string, calls: number, usd: number, readUsd: number, rebuildUsd: number }[]} */
  const days = []
  if (a.daily.size && total.first !== undefined && total.last !== undefined) {
    // From the first day with a reply, so a short history does not leave the chart mostly empty.
    const start = new Date(total.first)
    const end = new Date(total.last)
    for (
      let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      d <= end;
      d.setDate(d.getDate() + 1)
    ) {
      const key = dayOf(d.getTime())
      const v = a.daily.get(key) ?? { calls: 0, usd: 0, readUsd: 0, rebuildUsd: 0 }
      days.push({
        day: key,
        calls: v.calls,
        usd: round2(v.usd),
        readUsd: round2(v.readUsd),
        rebuildUsd: round2(v.rebuildUsd),
      })
    }
  }

  const sessionRow = (/** @type {Session} */ s) => ({
    id: s.id.slice(0, 8),
    tool: s.tool,
    project: nameOf(s.project),
    branch: anon ? '' : s.branch,
    started: new Date(s.first ?? 0).toISOString(),
    ended: new Date(s.last ?? 0).toISOString(),
    calls: s.calls,
    peak: s.peak,
    usd: round2(s.cost),
    rereadShare: round1(pct(s.readCost + s.rebuildCost, s.cost)),
    rebuilds: { cold: s.rebuilds.cold.n, model: s.rebuilds.model.n, prefix: s.rebuilds.prefix.n },
  })

  const data = {
    version,
    generatedAt: now.toISOString(),
    span,
    anon,
    product,
    summary: {
      sessions: list.length,
      calls: total.calls,
      rereadShare: round1(share),
      cacheReadShare: round1(pct(total.readCost, total.cost)),
      rebuildShare: round1(pct(total.rebuildCost, total.cost)),
      otherShare: round1(100 - share),
      tokensReadFromCache: round1(pct(total.tokensRead, total.tokensIn)),
      longContextShare: round1(pct(total.longCost, total.cost)),
      apiEquivalentUSD: round2(total.cost),
      rebuilds: /** @type {Record<Reason, { count: number, usd: number, share: number }>} */ (
        Object.fromEntries(
          REASONS.map((w) => [
            w,
            { count: rb[w].n, usd: round2(rb[w].cost), share: round1(pct(rb[w].cost, total.cost)) },
          ]),
        )
      ),
    },
    tools: tools.map(([tool, t]) => ({
      tool,
      name: TOOLS[tool].name,
      sessions: t.sessions,
      calls: t.calls,
      usd: round2(t.cost),
      rereadShare: round1(pct(t.reread, t.cost)),
    })),
    daily: days,
    buckets: BUCKETS.flatMap(([, label]) => {
      const v = a.buckets.get(label)
      return v ? [{ label, calls: v.calls, usd: round2(v.usd), readUsd: round2(v.readUsd) }] : []
    }),
    models: [...a.models]
      .sort((x, y) => y[1].usd - x[1].usd)
      .map(([model, v]) => ({
        model,
        calls: v.calls,
        usd: round2(v.usd),
        readUsd: round2(v.readUsd),
        rebuildUsd: round2(v.rebuildUsd),
      })),
    projects: projects.map((p) => ({
      project: nameOf(p.project),
      sessions: p.sessions,
      calls: p.calls,
      usd: round2(p.cost),
      rereadShare: round1(pct(p.reread, p.cost)),
    })),
    sessions: list.map(sessionRow),
    findings: findingsOf(a, [...toolMap.keys()]),
    share: `${share.toFixed(0)}% of my ${product} usage over ${span} was re-reading context. Check yours: npx reread-cli`,
  }
  return data
}

/**
 * The report's data: the costliest sessions, each with its replies as chart points (kept out of --json to keep it
 * small).
 * @param {Analysis} a
 * @param {Report} data  summarize(a, ...)
 * @param {number} [max]  sessions to keep
 */
export function withPoints(a, data, max = 100) {
  return {
    ...data,
    sessions: data.sessions.slice(0, max).map((row, i) => ({ ...row, points: thin(a.sessions[i].points) })),
  }
}

/**
 * Keep at most `max` points, always keeping the ones where something happened and the last one.
 * @template {[number, number, number, number]} P
 * @param {P[]} points
 * @param {number} [max]
 */
export function thin(points, max = 400) {
  if (points.length <= max) return points
  const step = Math.ceil(points.length / max)
  return points.filter((pt, i) => i % step === 0 || pt[3] !== FLAG.none || i === points.length - 1)
}
