// @ts-check
// Reading Claude Code's session files: ~/.claude/projects/<folder>/<session-id>.jsonl, a subagent's in
// <session-id>/subagents/. Each line is one JSON event; ReRead keeps only the token counts, model, time and id of each
// reply, plus the folder and git branch of the session. It never keeps or prints what was written in the conversation.
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { eachLine, existingDirs, isInside, splitLines } from './files.js'

/** @typedef {import('./prices.js').Call} Call */

const USAGE = Buffer.from('"usage"')
const CWD = Buffer.from('"cwd"')
const BRANCH = Buffer.from('"gitBranch"')

/**
 * The folders Claude Code may keep sessions in, most specific first.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home]
 */
export function claudeDirs(env = process.env, home = homedir()) {
  return [
    env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, 'projects') : '',
    path.join(home, '.claude', 'projects'),
    path.join(home, '.config', 'claude', 'projects'),
  ].filter(Boolean)
}

/**
 * The folder name Claude Code gives a project: its path, with every character that is not a letter or digit as '-'.
 * Different paths can share a name ('a b' and 'a-b'), so a session's own `cwd` is what decides.
 * @param {string} cwd
 */
export const claudeFolderName = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-')

/**
 * The folder a session ran in, from the first line that names it (near the top of the file), or ''.
 * @param {string} file
 */
export function cwdOf(file) {
  let fd
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(256 * 1024)
    const got = readSync(fd, buf, 0, buf.length, 0)
    let cwd = ''
    splitLines(buf.subarray(0, got), (line) => {
      if (cwd || !line.includes(CWD)) return
      try {
        const v = JSON.parse(line.toString('utf8')).cwd
        if (typeof v === 'string') cwd = v
      } catch {
        /* not JSON, or cut off at the end of the buffer */
      }
    })
    return cwd
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * The session file written to last, of the sessions that ran in one of these folders or a folder inside one. Subagent
 * files are left out: the status of a session is its main file's.
 * @param {string[]} folders
 * @param {{ dirs?: string[], cwdCache?: Map<string, string> }} [opts]  cwdCache: file to cwd, kept between calls
 * @returns {string | null}
 */
export function latestClaudeSession(folders, { dirs = claudeDirs(), cwdCache = new Map() } = {}) {
  const root = existingDirs(dirs)[0]
  if (!root || !folders.length) return null
  const names = folders.map(claudeFolderName)
  let best = null
  let bestTime = -1
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const d of entries) {
    if (!d.isDirectory() || !names.some((n) => d.name === n || d.name.startsWith(`${n}-`))) continue
    const dir = path.join(root, d.name)
    let files
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue
      const f = path.join(dir, name)
      let t
      try {
        t = statSync(f).mtimeMs
      } catch {
        continue
      }
      if (t <= bestTime) continue
      let cwd = cwdCache.get(f)
      if (cwd === undefined) {
        cwd = cwdOf(f)
        if (cwd) cwdCache.set(f, cwd)
      }
      if (!cwd || !folders.some((folder) => isInside(cwd, folder))) continue
      best = f
      bestTime = t
    }
  }
  return best
}

/**
 * One line of a session file as a reply, or null when it is not one. Only token counts, the model, the time and
 * the ids are kept.
 * @param {string} line
 * @param {number} since  replies before this time are left out
 * @returns {Call | null}
 */
export function callOf(line, since) {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null
  let j
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  const m = j?.message
  const u = m?.usage
  if (j.type !== 'assistant' || !u || typeof u !== 'object' || m.model === '<synthetic>') return null
  const ts = Date.parse(j.timestamp)
  if (!(ts >= since)) return null
  const n = (/** @type {unknown} */ v) => (typeof v === 'number' && v > 0 ? v : 0)
  // Some replies list 1-hour writes in the breakdown while the total says 0; the breakdown is kept.
  const cw = n(u.cache_creation_input_tokens)
  const cw1 = n(u.cache_creation?.ephemeral_1h_input_tokens)
  return {
    key: `${m.id}|${j.requestId ?? ''}`,
    ts,
    model: typeof m.model === 'string' ? m.model : '',
    input: n(u.input_tokens),
    cw5: Math.max(0, cw - cw1),
    cw1,
    read: n(u.cache_read_input_tokens),
    out: n(u.output_tokens),
  }
}

/**
 * Add a reply to a map of replies. Claude Code writes a reply once per content block with the same ids, so each is
 * kept once, with the largest output count seen.
 * @param {Map<string, Call>} calls
 * @param {Call} call
 */
export function collect(calls, call) {
  const old = calls.get(call.key)
  if (old) old.out = Math.max(old.out, call.out)
  else calls.set(call.key, call)
}

/**
 * Read the replies of one session file. A resumed or forked session copies the replies it carries over into its new
 * file: those are marked `seen` (walked for the cache, counted once) and every key is added to `seen`.
 * @param {string} file
 * @param {number} since
 * @param {Set<string>} seen  the replies already counted in files read before
 * @returns {import('./tools.js').Read}
 */
export function readClaudeFile(file, since, seen) {
  /** @type {Map<string, Call>} */
  const calls = new Map()
  let cwd = ''
  let branch = ''
  /** @param {Buffer} buf */
  const onLine = (buf) => {
    if (!cwd && buf.includes(CWD)) {
      try {
        const v = JSON.parse(buf.toString('utf8')).cwd
        if (typeof v === 'string') cwd = v
      } catch {
        /* not JSON */
      }
    }
    if (!branch && buf.includes(BRANCH)) {
      try {
        const b = JSON.parse(buf.toString('utf8')).gitBranch
        if (typeof b === 'string' && b && b !== 'HEAD') branch = b
      } catch {
        /* not JSON */
      }
    }
    if (!buf.includes(USAGE)) return
    const call = callOf(buf.toString('utf8'), since)
    if (call) collect(calls, call)
  }
  eachLine(file, onLine)
  for (const [key, c] of calls) {
    c.seen = seen.has(key)
    seen.add(key)
  }
  // A subagent's file sits in <session>/subagents/; it counts toward that session.
  const parts = file.split(path.sep)
  const sub = parts.length > 2 && parts.at(-2) === 'subagents'
  const id = sub ? parts[parts.length - 3] : path.basename(file, '.jsonl')
  return { id, sub, cwd, branch, calls: [...calls.values()].sort((a, b) => a.ts - b.ts) }
}
