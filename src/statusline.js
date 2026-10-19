// @ts-check
// `reread statusline`: one line for Claude Code's status line. Claude Code runs the command on each redraw and
// pipes it a JSON object with `transcript_path`, the current session's file.
//
// A session file can grow to hundreds of megabytes, so the replies read so far are kept in a small cache file
// (token counts only) and each run reads only the bytes added since the last one.
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { walk } from './analyze.js'
import { pct, tokens } from './format.js'
import { callOf, collect } from './claude.js'
import { readLines } from './files.js'
import { contextOf, priceOf } from './prices.js'

/** @typedef {import('./prices.js').Call} Call */

const CACHE_VERSION = 1
const CACHE_MAX_AGE = 2 * 86400e3
const USAGE = Buffer.from('"usage"')

/**
 * The status line for a session file.
 * @param {string} input  what Claude Code piped in
 * @param {{ now?: number, color?: boolean, cacheDir?: string | null }} [opts]  cacheDir null: no cache
 */
export function statusline(input, { now = Date.now(), color = false, cacheDir = defaultCacheDir() } = {}) {
  let file = ''
  try {
    const v = JSON.parse(input || '{}').transcript_path
    if (typeof v === 'string') file = v
  } catch {
    /* not JSON */
  }
  if (!file || !existsSync(file)) return 'reread: no session yet'

  const s = sessionState(file, { cacheDir })
  if (!s) return 'reread: no replies yet'

  const paint = (/** @type {number} */ code) => (/** @type {string} */ t) => (color ? `\x1b[${code}m${t}\x1b[0m` : t)
  const left = s.warmUntil - now
  const parts = [`ctx ${tokens(s.ctx)}`]
  if (left > 0) parts.push(paint(left < 60e3 ? 33 : 32)(`cache warm ${clock(left)}`))
  else parts.push(paint(31)(`cache cold: next reply rewrites ${tokens(s.ctx)} (~$${s.rewriteUsd.toFixed(2)})`))
  parts.push(`re-read ${s.rereadPct.toFixed(0)}%`)
  return parts.join(' · ')
}

/**
 * Minutes and seconds, as 3:41.
 * @param {number} ms
 */
export const clock = (ms) => `${Math.floor(ms / 60e3)}:${String(Math.floor((ms % 60e3) / 1e3)).padStart(2, '0')}`

/**
 * Where a session stands: the context its last reply sent, until when the cache stays warm, what writing the context
 * to the cache again would cost, and how much of the session so far was re-reading. Null before the first reply.
 * @param {string} file
 * @param {{ cacheDir?: string | null }} [opts]  cacheDir null: no cache
 */
export function sessionState(file, { cacheDir = defaultCacheDir() } = {}) {
  const calls = readCalls(file, cacheDir)
  const s = walk([...calls.values()].sort((a, b) => a.ts - b.ts))
  if (!s.lastCall) return null
  const ctx = contextOf(s.lastCall)
  const p = priceOf(s.lastCall.model, ctx)
  return {
    model: s.lastCall.model,
    ctx,
    lastReply: s.lastCall.ts,
    /** the cache's life: 5 minutes, or 1 hour once the session has written to the 1-hour cache */
    ttl: s.ttl,
    warmUntil: s.lastCall.ts + s.ttl,
    rewriteUsd: (ctx * (s.ttl > 300e3 ? p.write1h : p.write5m)) / 1e6,
    rereadPct: pct(s.readCost + s.rebuildCost, s.cost),
    usd: s.cost,
    replies: calls.size,
  }
}

/**
 * Every reply in a session file, reading only what was added since the cached state.
 * @param {string} file
 * @param {string | null} cacheDir
 * @returns {Map<string, Call>}
 */
function readCalls(file, cacheDir) {
  const st = statSync(file)
  const cacheFile = cacheDir
    ? path.join(cacheDir, `${createHash('sha256').update(file).digest('hex').slice(0, 24)}.json`)
    : ''
  /** @type {Map<string, Call>} */
  const calls = new Map()
  let from = 0

  const cached = cacheFile ? loadCache(cacheFile) : null
  if (cached && cached.file === file && cached.ino === st.ino && cached.offset <= st.size) {
    for (const c of cached.calls) calls.set(c.key, c)
    from = cached.offset
  }

  /** @param {Buffer} buf */
  const onLine = (buf) => {
    if (!buf.includes(USAGE)) return
    const c = callOf(buf.toString('utf8'), 0)
    if (c) collect(calls, c)
  }
  const { offset, rest } = readLines(file, from, onLine)

  if (cacheFile && (offset !== from || !cached)) {
    saveCache(cacheFile, { v: CACHE_VERSION, file, ino: st.ino, offset, calls: [...calls.values()] })
  }
  // A last line still being written is counted now but read again next time.
  if (rest.length) onLine(rest)
  return calls
}

/**
 * A per-user folder for the cache, or null when one cannot be made safely.
 * @returns {string | null}
 */
export function defaultCacheDir() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  const dir = path.join(tmpdir(), `reread-${uid ?? 'user'}`)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const st = lstatSync(dir)
    // Someone else's folder, or a link to one, is never used.
    if (!st.isDirectory() || st.isSymbolicLink() || (uid !== null && st.uid !== uid)) return null
    return dir
  } catch {
    return null
  }
}

/**
 * @param {string} file
 * @returns {{ v: number, file: string, ino: number, offset: number, calls: Call[] } | null}
 */
function loadCache(file) {
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'))
    return c && c.v === CACHE_VERSION && Array.isArray(c.calls) && Number.isInteger(c.offset) ? c : null
  } catch {
    return null
  }
}

/**
 * Write the cache through a temp file and a rename, so a reader never sees half a file. Old caches are removed now
 * and then.
 * @param {string} file
 * @param {object} value
 */
function saveCache(file, value) {
  try {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
    renameSync(tmp, file)
    if (Math.random() < 0.05) prune(path.dirname(file))
  } catch {
    /* the cache only saves time; the line is right without it */
  }
}

/** @param {string} dir */
function prune(dir) {
  const cutoff = Date.now() - CACHE_MAX_AGE
  for (const name of readdirSync(dir)) {
    const f = path.join(dir, name)
    try {
      if (statSync(f).mtimeMs < cutoff) unlinkSync(f)
    } catch {
      /* gone already */
    }
  }
}
