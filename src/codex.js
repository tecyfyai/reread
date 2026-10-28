// @ts-check
// Reading Codex's session files ("rollouts"): ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, and archived ones in
// ~/.codex/archived_sessions (zstd-compressed, read where Node.js can decompress zstd). As with Claude Code, only token
// counts, the model, the effort level, the time and ids are kept, plus the folder and git branch from the session's header.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { eachLine, splitLines } from './files.js'

/** @typedef {import('./prices.js').Call} Call */

/**
 * The folders Codex keeps sessions in.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home]
 */
export function codexDirs(env = process.env, home = homedir()) {
  const base = env.CODEX_HOME || path.join(home, '.codex')
  return [path.join(base, 'sessions'), path.join(base, 'archived_sessions')]
}

/** Whether a file is a Codex session file: rollout-<time>-<id>.jsonl, or .jsonl.zst when archived. */
export function isCodexFile(/** @type {string} */ file) {
  const name = path.basename(file)
  return name.startsWith('rollout-') && (name.endsWith('.jsonl') || name.endsWith('.jsonl.zst'))
}

/** Whether this Node.js can read compressed (archived) Codex sessions. */
export const canReadZstd = typeof (/** @type {any} */ (zlib).zstdDecompressSync) === 'function'

const MARKS = ['"session_meta"', '"turn_context"', '"token_usage_record"', '"token_count"'].map((m) => Buffer.from(m))

/**
 * @param {unknown} v
 * @returns {number}
 */
const n = (v) => (typeof v === 'number' && v > 0 ? v : 0)

/**
 * A usage object into a reply. OpenAI counts cached and cache-written tokens inside input_tokens.
 * @param {any} u
 * @param {string} key
 * @param {number} ts
 * @param {string} model
 * @param {string} effort
 * @returns {Call}
 */
function callFrom(u, key, ts, model, effort) {
  const read = n(u.cached_input_tokens)
  const cw = n(u.cache_write_input_tokens)
  return {
    key,
    ts,
    model,
    input: Math.max(0, n(u.input_tokens) - read - cw),
    cw5: cw,
    cw1: 0,
    read,
    out: n(u.output_tokens),
    think: Math.min(n(u.reasoning_output_tokens), n(u.output_tokens)),
    effort,
  }
}

/**
 * Read the replies of one Codex session file.
 *
 * Newer Codex versions write a `token_usage_record` for each model response, with its id. Older ones write only
 * `token_count` events, repeated when nothing changed; there each new running total is one response.
 * @param {string} file
 * @param {number} since
 * @param {Set<string>} seen  replies already counted in files read before
 * @returns {import('./tools.js').Read}
 */
export function readCodexFile(file, since, seen) {
  let id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(path.basename(file))?.[1] ?? ''
  let cwd = ''
  let branch = ''
  let model = ''
  let effort = ''
  /** @type {Map<string, Call>} */
  const records = new Map()
  /** @type {Map<string, Call>} */
  const counts = new Map()
  let lastTotal = -1

  /** @param {Buffer} buf */
  const onLine = (buf) => {
    if (!MARKS.some((m) => buf.includes(m))) return
    let j
    try {
      j = JSON.parse(buf.toString('utf8'))
    } catch {
      return
    }
    const p = j?.payload
    if (!p || typeof p !== 'object') return
    if (j.type === 'session_meta') {
      if (typeof p.id === 'string' && p.id) id = p.id
      if (typeof p.cwd === 'string') cwd = p.cwd
      if (typeof p.git?.branch === 'string') branch = p.git.branch
      return
    }
    if (j.type === 'turn_context') {
      if (typeof p.model === 'string' && p.model) model = p.model
      if (typeof p.effort === 'string') effort = p.effort
      return
    }
    const ts = Date.parse(j.timestamp)
    if (j.type === 'token_usage_record' && p.usage && typeof p.usage === 'object') {
      const key = `codex|${p.response_id ?? `${id}|${j.ordinal}`}`
      if (ts >= since && !records.has(key)) records.set(key, callFrom(p.usage, key, ts, model, effort))
      return
    }
    if (j.type === 'event_msg' && p.type === 'token_count') {
      const total = p.info?.total_token_usage?.total_tokens
      const last = p.info?.last_token_usage
      if (typeof total !== 'number' || total === lastTotal || !last) return
      lastTotal = total
      const key = `codex|${id}|${total}`
      if (ts >= since) counts.set(key, callFrom(last, key, ts, model, effort))
    }
  }

  if (file.endsWith('.zst')) {
    if (!canReadZstd) return { id, sub: false, cwd, branch, calls: [], unread: true }
    const data = /** @type {any} */ (zlib).zstdDecompressSync(readFileSync(file))
    splitLines(data, onLine)
  } else {
    eachLine(file, onLine)
  }

  const calls = [...(records.size ? records : counts).values()].sort((a, b) => a.ts - b.ts)
  for (const c of calls) {
    c.seen = seen.has(c.key)
    seen.add(c.key)
  }
  return { id, sub: false, cwd, branch, calls }
}
