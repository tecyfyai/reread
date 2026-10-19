// @ts-check
// Reading Antigravity's conversations: ~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl for
// the CLI (agy), ~/.gemini/antigravity/brain/... for the app. Each step the model took is one line; ReRead keeps only
// its token counts and time. The transcript does not name the model, so replies are priced at the model in
// Antigravity's settings. The conversation's folder is read from its database file (with Node.js's SQLite reader,
// where there is one) or from Antigravity's list of recent conversations.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eachLine } from './files.js'

/** @typedef {import('./prices.js').Call} Call */

/** The model Antigravity starts with, for when its settings name none. */
export const DEFAULT_MODEL = 'gemini-3.8-flash'

/**
 * The folders Antigravity keeps conversations in: the CLI's and the app's.
 * @param {string} [home]
 */
export const antigravityDirs = (home = homedir()) => [
  path.join(home, '.gemini', 'antigravity-cli', 'brain'),
  path.join(home, '.gemini', 'antigravity', 'brain'),
]

/**
 * Whether a file is an Antigravity conversation's transcript: brain/<id>/.system_generated/logs/transcript.jsonl.
 * @param {string} file
 */
export function isAntigravityFile(file) {
  const parts = file.split(path.sep)
  return parts.at(-1) === 'transcript.jsonl' && parts.at(-2) === 'logs' && parts.at(-3) === '.system_generated'
}

/**
 * Whether a file is one of Antigravity's own, not a transcript to read (its other logs repeat the transcript).
 * @param {string} file
 */
export const isAntigravityOther = (file) => file.split(path.sep).includes('.system_generated')

/**
 * A model's display name into the id ReRead prices: 'Gemini 3.8 Flash (High)' into 'gemini-3.8-flash',
 * 'Claude Sonnet 4.6 (Thinking)' into 'claude-sonnet-4-6'.
 * @param {unknown} name
 */
export function modelId(name) {
  if (typeof name !== 'string' || !name.trim()) return DEFAULT_MODEL
  const id = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
  return id.startsWith('claude-') ? id.replace(/\./g, '-') : id
}

/** @type {Map<string, { model: string, folders: Map<string, string> }>} */
const bases = new Map()

/**
 * What one Antigravity folder knows: the model in its settings, and the last folder each conversation ran in.
 * @param {string} base  ~/.gemini/antigravity-cli or ~/.gemini/antigravity
 */
function baseOf(base) {
  let b = bases.get(base)
  if (b) return b
  b = { model: DEFAULT_MODEL, folders: new Map() }
  try {
    b.model = modelId(JSON.parse(readFileSync(path.join(base, 'settings.json'), 'utf8')).model)
  } catch {
    /* no settings */
  }
  try {
    const last = JSON.parse(readFileSync(path.join(base, 'cache', 'last_conversations.json'), 'utf8'))
    for (const [folder, id] of Object.entries(last)) if (typeof id === 'string') b.folders.set(id, folder)
  } catch {
    /* no list */
  }
  bases.set(base, b)
  return b
}

const FILE_URL = Buffer.from('file:///')

/**
 * The first file:// address in a protocol buffer: a string field, its length a varint of 1 or 2 bytes before it.
 * @param {Uint8Array} bytes
 */
export function folderFromBytes(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = buf.indexOf(FILE_URL); i > 0; i = buf.indexOf(FILE_URL, i + 1)) {
    const lens = [buf[i - 1] < 0x80 ? buf[i - 1] : -1]
    if (i > 1 && buf[i - 2] >= 0x80 && buf[i - 1] < 0x80) lens.push((buf[i - 2] & 0x7f) | (buf[i - 1] << 7))
    for (const len of lens) {
      if (len < FILE_URL.length || i + len > buf.length) continue
      const text = buf.subarray(i, i + len)
      if (text.some((c) => c < 0x20)) continue
      try {
        return fileURLToPath(text.toString('utf8'))
      } catch {
        /* not a file address */
      }
    }
  }
  return ''
}

/** Node.js's own SQLite reader, where this Node.js has one (22.13 and newer), without its experimental warning. */
const sqlite = (() => {
  const get = /** @type {any} */ (process).getBuiltinModule
  if (typeof get !== 'function') return null
  const warn = process.emitWarning
  try {
    process.emitWarning = /** @type {any} */ (() => {})
    return get('node:sqlite') ?? null
  } catch {
    return null
  } finally {
    process.emitWarning = warn
  }
})()

/**
 * The folder a conversation ran in, from the trajectory record in its database file.
 * @param {string} db
 */
export function folderFromDb(db) {
  if (!sqlite || !existsSync(db)) return ''
  let conn
  try {
    conn = new sqlite.DatabaseSync(db, { readOnly: true })
    const row = conn.prepare('SELECT data FROM trajectory_metadata_blob LIMIT 1').get()
    return row?.data instanceof Uint8Array ? folderFromBytes(row.data) : ''
  } catch {
    return ''
  } finally {
    conn?.close()
  }
}

/**
 * Read the replies of one Antigravity conversation.
 * @param {string} file  .../brain/<id>/.system_generated/logs/transcript.jsonl
 * @param {number} since
 * @param {Set<string>} seen  replies already counted in files read before
 * @returns {import('./tools.js').Read}
 */
export function readAntigravityFile(file, since, seen) {
  const convo = path.resolve(file, '..', '..', '..')
  const id = path.basename(convo)
  const base = path.dirname(path.dirname(convo))
  const { model, folders } = baseOf(base)
  /** @type {Map<string, Call>} */
  const calls = new Map()

  const MARK = Buffer.from('"input_tokens"')
  /** @param {Buffer} buf */
  const onLine = (buf) => {
    if (!buf.includes(MARK)) return
    let j
    try {
      j = JSON.parse(buf.toString('utf8'))
    } catch {
      return
    }
    const ts = Date.parse(j?.created_at)
    if (!(ts >= since)) return
    const n = (/** @type {unknown} */ v) => (typeof v === 'number' && v > 0 ? v : 0)
    const key = `agy|${id}|${j.step_index}`
    calls.set(key, {
      key,
      ts,
      model,
      input: n(j.input_tokens),
      cw5: 0,
      cw1: 0,
      read: n(j.cache_read_tokens),
      out: n(j.output_tokens),
    })
  }
  eachLine(file, onLine)

  const list = [...calls.values()].sort((a, b) => a.ts - b.ts)
  for (const c of list) {
    c.seen = seen.has(c.key)
    seen.add(c.key)
  }
  const cwd = list.length ? folderFromDb(path.join(base, 'conversations', `${id}.db`)) || folders.get(id) || '' : ''
  return { id, sub: false, cwd, branch: '', calls: list }
}
