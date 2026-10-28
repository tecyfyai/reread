// @ts-check
// Key findings: a few short cards, each with one number, what it means and what to do, the costliest first.
import { pct, round2, tokens, usd } from './format.js'
import { TOOLS } from './tools.js'

/**
 * @typedef {object} Finding
 * @property {string} id
 * @property {string} value   the number on the card
 * @property {string} title
 * @property {string} text
 * @property {string} action
 * @property {number | null} usd  what it is about, in US dollars at API prices; null when it has no price
 */

/** Context sizes counted as long in the long-context finding (from 150k up). */
const LONG = ['150–200k', '200–500k', '500k+']

/** The rebuild reason's words: why it happened, and what to do. */
const LOST = {
  cold: {
    why: (/** @type {number} */ n) => `mostly after breaks longer than the cache's life (${n} times)`,
    action: 'Before a long break, compact or finish the session; a cold cache writes the whole history again.',
  },
  model: {
    why: (/** @type {number} */ n) => `mostly from switching model mid-session (${n} times)`,
    action: 'Pick the model at the start of a task; each model has its own cache.',
  },
  prefix: {
    why: (/** @type {number} */ n) =>
      `mostly from changes near the start of the context, such as tools, MCP servers or settings (${n} times)`,
    action: 'Avoid changing tools, MCP servers or settings in the middle of a long session.',
  },
}

/**
 * The compaction advice, for the tools used.
 * @param {import('./tools.js').Tool[]} tools
 */
function freshAction(tools) {
  if (tools.length === 1 && tools[0] === 'claude') {
    return 'Run /compact earlier, or /clear when you switch task, instead of waiting for the automatic compaction.'
  }
  if (tools.length === 1 && tools[0] === 'codex') {
    return 'Run /compact earlier, or /new when you switch task, instead of waiting for the automatic compaction.'
  }
  return `Compact earlier, or start fresh when you switch task (${tools.map((t) => TOOLS[t].fresh).join(', ')}).`
}

/**
 * How to lower the effort level, in the tools used that record thinking.
 * @param {import('./tools.js').Tool[]} tools
 */
function effortAction(tools) {
  const ways = []
  if (tools.includes('claude')) ways.push('claude --effort low in Claude Code')
  if (tools.includes('codex')) ways.push('model_reasoning_effort in ~/.codex/config.toml for Codex')
  return `For routine tasks, use a lower effort level (${ways.join('; ') || 'in your tool'}); keep the higher levels for hard problems.`
}

/**
 * @param {import('./analyze.js').Analysis} a
 * @param {import('./tools.js').Tool[]} [tools]  the tools the sessions came from
 * @returns {Finding[]}
 */
export function findingsOf(a, tools = ['claude']) {
  const { total, sessions } = a
  /** @type {Finding[]} */
  const out = []

  const top10 = sessions.slice(0, 10).reduce((sum, s) => sum + s.cost, 0)
  const topShare = pct(top10, total.cost)
  if (sessions.length >= 15 && topShare >= 30) {
    out.push({
      id: 'concentration',
      value: `${topShare.toFixed(0)}%`,
      title: `Your 10 costliest sessions made ${topShare.toFixed(0)}% of your usage`,
      text: `Out of ${sessions.length} sessions. A few long sessions drive most of the bill.`,
      action: 'Open them in the sessions table to see where each one grew.',
      usd: round2(top10),
    })
  }

  let longCost = 0
  let longRead = 0
  let longCalls = 0
  for (const [label, v] of a.buckets) {
    if (!LONG.includes(label)) continue
    longCost += v.usd
    longRead += v.readUsd
    longCalls += v.calls
  }
  const longShare = pct(longCost, total.cost)
  if (longShare >= 20) {
    out.push({
      id: 'long-context',
      value: `${longShare.toFixed(0)}%`,
      title: `Replies past 150k context made ${longShare.toFixed(0)}% of your usage`,
      text: `${longCalls.toLocaleString('en-US')} replies, each re-reading at least 150k tokens of history; ${pct(longRead, longCost).toFixed(0)}% of what they cost was that re-reading.`,
      action: 'Start a fresh session for each new task, so every reply re-reads less.',
      usd: round2(longCost),
    })
  }

  if (total.compact.n >= 3) {
    const avg = tokens(total.compact.ctx / total.compact.n)
    out.push({
      id: 'compaction',
      value: avg,
      title: `Your context was compacted or cleared ${total.compact.n} times, at ${avg} on average`,
      text: 'Every reply before that point re-read the whole context, so the longer it grows before a compaction, the more each reply costs.',
      action: freshAction(tools.length ? tools : ['claude']),
      usd: null,
    })
  }

  const rb = total.rebuilds
  const reasons = /** @type {const} */ (['cold', 'model', 'prefix'])
  const [worst] = [...reasons].sort((x, y) => rb[y].cost - rb[x].cost)
  const lostShare = pct(total.rebuildCost, total.cost)
  if (lostShare >= 1 && rb[worst].n) {
    out.push({
      id: 'cache-lost',
      value: usd(total.rebuildCost),
      title: `Losing the cache cost ${usd(total.rebuildCost)}, ${lostShare.toFixed(1)}% of your usage`,
      text: `The whole history was written again ${rb.cold.n + rb.model.n + rb.prefix.n} times, ${LOST[worst].why(rb[worst].n)}.`,
      action: LOST[worst].action,
      usd: round2(total.rebuildCost),
    })
  }

  const thinkShare = pct(total.thinkCost, total.cost)
  if (thinkShare >= 3) {
    const levels = [...a.efforts.values()].filter((e) => e.out > 0 && e.calls >= 20)
    const lo = levels.reduce((m, e) => (!m || e.think / e.out < m.think / m.out ? e : m), /** @type {any} */ (null))
    const hi = levels.reduce((m, e) => (!m || e.think / e.out > m.think / m.out ? e : m), /** @type {any} */ (null))
    const spread =
      lo && hi && lo !== hi
        ? ` At ${hi.effort} effort in ${TOOLS[/** @type {import('./tools.js').Tool} */ (hi.tool)].name}, ${pct(hi.think, hi.out).toFixed(0)}% of the output was thinking; at ${lo.effort} effort in ${TOOLS[/** @type {import('./tools.js').Tool} */ (lo.tool)].name}, ${pct(lo.think, lo.out).toFixed(0)}%.`
        : ''
    out.push({
      id: 'thinking',
      value: usd(total.thinkCost),
      title: `Thinking made ${pct(total.think, total.out).toFixed(0)}% of your output tokens, ${thinkShare.toFixed(1)}% of your usage`,
      text: `${tokens(total.think)} thinking tokens, billed as output.${spread}`,
      action: effortAction(tools),
      usd: round2(total.thinkCost),
    })
  }

  return out.sort((x, y) => (y.usd ?? 0) - (x.usd ?? 0))
}
