// @ts-check
// What the extension shows, built from ReRead's own code, with nothing from VS Code in it, so the worker can run it
// and the tests can call it directly.
import { statSync } from 'node:fs'
import { analyze, summarize, withPoints } from '../../src/analyze.js'
import { latestClaudeSession } from '../../src/claude.js'
import { tokens } from '../../src/format.js'
import { VERSION } from '../../src/meta.js'
import { buildReport, readTemplate } from '../../src/report.js'
import { clock, sessionState } from '../../src/statusline.js'
import { rootsFor, sessionFiles } from '../../src/tools.js'

/** @typedef {NonNullable<ReturnType<typeof sessionState>>} State */

/** A session whose last reply is older than this is not shown. */
export const STALE = 12 * 3600e3

/** @type {Map<string, string>} */
const cwdCache = new Map()

/**
 * The state of the latest Claude Code session in these folders, or null when there is none.
 * @param {string[]} folders
 * @returns {{ file: string, state: State } | null}
 */
export function workspaceState(folders) {
  const file = latestClaudeSession(folders, { cwdCache })
  if (!file) return null
  const st = statSync(file)
  // The file is read again only when it has grown or changed.
  if (last?.file !== file || last.size !== st.size || last.mtime !== st.mtimeMs) {
    last = { file, size: st.size, mtime: st.mtimeMs, state: sessionState(file) }
  }
  return last.state ? { file, state: last.state } : null
}

/** @type {{ file: string, size: number, mtime: number, state: State | null } | null} */
let last = null

/**
 * The status bar item for a session: its text, its tooltip (Markdown) and whether the cache is cold. Null when there
 * is nothing worth showing.
 * @param {State | null} s
 * @param {number} now
 */
export function statusView(s, now) {
  if (!s || now - s.lastReply > STALE) return null
  const left = s.warmUntil - now
  const cold = left <= 0
  const life = s.ttl > 300e3 ? '1-hour' : '5-minute'
  const cache = cold
    ? `**Cache cold** for ${clock(-left)}. The next reply writes the whole ${tokens(s.ctx)} context to the cache ` +
      `again${s.rewriteUsd === null ? '' : `, about $${s.rewriteUsd.toFixed(2)} at API prices`}. Starting fresh (\`/clear\`) or compacting first costs less.`
    : `**Cache warm** for ${clock(left)} more (the ${life} cache). A reply before then reads the context from the ` +
      `cache at a fraction of the price.`
  return {
    text: `$(history) ${tokens(s.ctx)} · ${cold ? 'cold' : clock(left)}`,
    cold,
    tooltip: [
      '**ReRead** · latest Claude Code session in this workspace',
      '',
      `Context: ${tokens(s.ctx)} tokens${s.model ? ` (${s.model})` : ''}`,
      '',
      cache,
      '',
      ...(s.rereadPct === null ? [] : [`Re-reading so far: ${s.rereadPct.toFixed(0)}% of this session's usage.`, '']),
      'Click for the report of this workspace.',
    ].join('\n'),
  }
}

/**
 * The report page for the sessions of the last `days` days, in these folders or everywhere.
 * @param {{ days: number, folders?: string[], now?: number }} opts
 * @returns {{ html: string, replies: number } | { html: null, message: string }}
 */
export function reportPage({ days, folders = [], now = Date.now() }) {
  const { roots } = rootsFor('all')
  if (!roots.length)
    return { html: null, message: 'No Claude Code, Codex or Antigravity sessions found on this machine.' }
  const since = days > 0 ? now - days * 86400e3 : 0
  const span = days > 0 ? `the last ${days} days` : 'every session still kept'
  const files = sessionFiles(roots, { since, project: '', tool: 'all', folders })
  const a = analyze(files, { since, folders })
  if (!a.total.calls) {
    const where = folders.length ? 'in this workspace' : 'on this machine'
    return { html: null, message: `No replies ${where} in ${span}.` }
  }
  const data = summarize(a, { span, anon: false, version: VERSION })
  return { html: buildReport(readTemplate(), withPoints(a, data)), replies: a.total.calls }
}

const SAVE_NAME = /^reread(-sessions)?-\d{4}-\d{2}-\d{2}\.(png|json|csv)$/
const MAX_SAVE = 20 * 1024 * 1024

/**
 * A file the report page asked to save, checked: only the names and kinds the page makes, and not too large.
 * @param {unknown} msg
 * @returns {{ name: string, ext: string, bytes: Buffer } | null}
 */
export function saveRequest(msg) {
  const m = /** @type {{ type?: unknown, name?: unknown, data?: unknown }} */ (msg ?? {})
  if (m.type !== 'save' || typeof m.name !== 'string' || typeof m.data !== 'string') return null
  const name = SAVE_NAME.exec(m.name)
  const comma = m.data.indexOf(',')
  if (!name || comma < 0 || !/^data:[\w.+/-]*;base64$/.test(m.data.slice(0, comma))) return null
  if (m.data.length > (MAX_SAVE * 4) / 3) return null
  return { name: m.name, ext: name[2], bytes: Buffer.from(m.data.slice(comma + 1), 'base64') }
}
