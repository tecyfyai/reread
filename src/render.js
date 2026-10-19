// @ts-check
// The terminal summary, the Markdown summary and the CSV. Each returns a string; the CLI prints it.
import { REASONS } from './analyze.js'
import { int, pct, tokens, usd } from './format.js'
import { HOMEPAGE, VERSION } from './meta.js'

/** @typedef {import('./analyze.js').Report} Report */

/**
 * A count and its noun: '1 session', '12 sessions'.
 * @param {number} n
 * @param {string} one
 * @param {string} [many]
 */
const plural = (n, one, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`

const NOTE = 'Plans count usage in their own way; the shares weigh each kind of token by its API price.'

const REASON_TEXT = {
  cold: 'Cache went cold (a break longer than its life)',
  model: 'Model changed mid-session',
  prefix: 'Something early in the context changed',
}

/**
 * The summary for the terminal.
 * @param {Report} data
 * @param {{ top: number, by: '' | 'project' | 'model' | 'day' | 'tool', color: boolean }} opts
 */
export function renderText(data, { top, by, color }) {
  const paint = (/** @type {number} */ code) => (/** @type {unknown} */ t) =>
    color ? `\x1b[${code}m${t}\x1b[0m` : String(t)
  const bold = paint(1)
  const dim = paint(2)
  const yellow = paint(33)
  const cyan = paint(36)
  const pad = (/** @type {unknown} */ t, /** @type {number} */ n) => String(t).padEnd(n)
  const lpad = (/** @type {unknown} */ t, /** @type {number} */ n) => String(t).padStart(n)
  const S = data.summary

  const out = [
    '',
    `  ${bold(yellow(`${S.rereadShare.toFixed(0)}%`))} ${bold(`of your ${data.product} usage was re-reading context`)}`,
    dim(
      `  ${data.span} · ${plural(S.sessions, 'session')} · ${plural(S.calls, 'reply', 'replies')} · ${usd(S.apiEquivalentUSD)} at API prices`,
    ),
    '',
    `  ${pad('Reading history from the cache', 34)}${lpad(`${S.cacheReadShare.toFixed(1)}%`, 7)}  ${dim(`${S.tokensReadFromCache}% of all tokens read`)}`,
    `  ${pad('Writing history again', 34)}${lpad(`${S.rebuildShare.toFixed(1)}%`, 7)}  ${dim('after the cache was lost')}`,
    `  ${pad('Everything else', 34)}${lpad(`${S.otherShare.toFixed(1)}%`, 7)}  ${dim('new input, first cache writes, output')}`,
    '',
  ]

  const reasons = REASONS.filter((w) => S.rebuilds[w].count)
  if (reasons.length) {
    out.push(bold('  Times the whole history was written again'))
    for (const w of reasons) {
      out.push(
        `  ${pad(REASON_TEXT[w], 48)}${lpad(S.rebuilds[w].count, 5)}  ${dim(`${S.rebuilds[w].share}% of usage`)}`,
      )
    }
    out.push('')
  }

  if (by) {
    /** @type {[string, number, number, number][]} */
    const rows =
      by === 'project'
        ? data.projects.map((p) => [p.project, p.calls, p.usd, p.rereadShare])
        : by === 'model'
          ? data.models.map((m) => [m.model, m.calls, m.usd, pct(m.readUsd + m.rebuildUsd, m.usd)])
          : by === 'tool'
            ? data.tools.map((t) => [t.name, t.calls, t.usd, t.rereadShare])
            : data.daily
                .filter((d) => d.calls)
                .map((d) => [d.day, d.calls, d.usd, pct(d.readUsd + d.rebuildUsd, d.usd)])
    out.push(bold(`  By ${by}`))
    out.push(dim(`  ${pad(by, 30)}${lpad('replies', 9)}${lpad('cost', 10)}${lpad('re-read', 9)}`))
    for (const [name, calls, cost, rr] of rows) {
      out.push(
        `  ${pad(name.slice(0, 28), 30)}${lpad(int(calls), 9)}${lpad(usd(cost), 10)}${lpad(`${rr.toFixed(0)}%`, 9)}`,
      )
    }
    out.push('')
  }

  if (top > 0) {
    out.push(bold('  Costliest sessions') + dim('  (API price of the same tokens)'))
    out.push(
      dim(
        `  ${pad('started', 12)}${pad('project', 24)}${lpad('replies', 8)}${lpad('peak ctx', 10)}${lpad('cost', 10)}${lpad('re-read', 9)}`,
      ),
    )
    for (const s of data.sessions.slice(0, top)) {
      out.push(
        `  ${pad(s.started.slice(0, 10), 12)}${pad((s.project || s.id).slice(0, 22), 24)}${lpad(s.calls, 8)}${lpad(tokens(s.peak), 10)}${lpad(usd(s.usd), 10)}${lpad(`${s.rereadShare.toFixed(0)}%`, 9)}`,
      )
    }
    out.push('')
  }

  if (data.findings.length) {
    out.push(bold('  Key findings'))
    for (const f of data.findings) out.push(`  · ${f.title}. ${dim(f.action)}`)
    out.push('')
  }

  out.push(dim(`  ${NOTE}`), '', `  ${dim('Share it:')} ${cyan(data.share)}`, '')
  return out.join('\n') + '\n'
}

/**
 * A Markdown summary, to paste into an issue or a pull request.
 * @param {Report} data
 * @param {{ top: number }} opts
 */
export function renderMarkdown(data, { top }) {
  const S = data.summary
  const cell = (/** @type {unknown} */ t) => String(t).replace(/\|/g, '\\|')
  const out = [
    `## ${S.rereadShare.toFixed(0)}% of my ${data.product} usage was re-reading context`,
    '',
    `_${data.span} · ${plural(S.sessions, 'session')} · ${plural(S.calls, 'reply', 'replies')} · ${usd(S.apiEquivalentUSD)} at API prices · [ReRead](${HOMEPAGE}) ${VERSION}_`,
    '',
    '| Where the usage went | Share |',
    '|---|---:|',
    `| Reading history from the cache | ${S.cacheReadShare.toFixed(1)}% |`,
    `| Writing history again, after the cache was lost | ${S.rebuildShare.toFixed(1)}% |`,
    `| Everything else (new input, first cache writes, output) | ${S.otherShare.toFixed(1)}% |`,
    '',
  ]
  const reasons = REASONS.filter((w) => S.rebuilds[w].count)
  if (reasons.length) {
    out.push(
      '| Why the history was written again | Times | Share |',
      '|---|---:|---:|',
      ...reasons.map((w) => `| ${REASON_TEXT[w]} | ${S.rebuilds[w].count} | ${S.rebuilds[w].share}% |`),
      '',
    )
  }
  if (top > 0) {
    out.push(
      '| Costliest sessions | Project | Replies | Peak context | API price | Re-read |',
      '|---|---|---:|---:|---:|---:|',
      ...data.sessions
        .slice(0, top)
        .map(
          (s) =>
            `| ${s.started.slice(0, 10)} \`${s.id}\` | ${cell(s.project)} | ${s.calls} | ${tokens(s.peak)} | ${usd(s.usd)} | ${s.rereadShare.toFixed(0)}% |`,
        ),
      '',
    )
  }
  if (data.findings.length) {
    out.push('### Key findings', '', ...data.findings.map((f) => `- **${f.title}.** ${f.text} ${f.action}`), '')
  }
  out.push(`_${NOTE}_`)
  return out.join('\n') + '\n'
}

/**
 * One CSV cell. A value that starts like a formula gets a leading ' so a spreadsheet app shows it as text.
 * @param {unknown} v
 */
export function csvCell(v) {
  let t = String(v)
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/** The CSV header, shared with the report's own CSV export. */
export const CSV_HEADER = [
  'session',
  'tool',
  'project',
  'branch',
  'started',
  'ended',
  'replies',
  'peak_context',
  'api_usd',
  'reread_pct',
  'rebuilds_cold',
  'rebuilds_model',
  'rebuilds_prefix',
]

/**
 * Every session as CSV.
 * @param {Report} data
 */
export function renderCsv(data) {
  const rows = data.sessions.map((s) =>
    [
      s.id,
      s.tool,
      s.project,
      s.branch,
      s.started,
      s.ended,
      s.calls,
      s.peak,
      s.usd,
      s.rereadShare,
      s.rebuilds.cold,
      s.rebuilds.model,
      s.rebuilds.prefix,
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_HEADER.join(','), ...rows].join('\n') + '\n'
}
