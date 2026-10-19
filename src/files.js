// @ts-check
// Walking folders for session files and reading them line by line, for every tool's reader.
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs'
import path from 'node:path'

/**
 * Every file under a folder that `keep` accepts. Symbolic links are not followed, so a link loop cannot hang the
 * walk, and a folder that cannot be read is skipped.
 * @param {string} dir
 * @param {(file: string) => boolean} keep
 * @returns {string[]}
 */
export function filesUnder(dir, keep) {
  /** @type {string[]} */
  const out = []
  /** @type {import('node:fs').Dirent[]} */
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...filesUnder(p, keep))
    else if (e.isFile() && keep(p)) out.push(p)
  }
  return out
}

/**
 * Whether a path is a folder or inside it. Paths are compared as written, ignoring case on macOS and Windows, whose
 * disks usually do.
 * @param {string} p
 * @param {string} folder
 */
export function isInside(p, folder) {
  const fold = process.platform === 'darwin' || process.platform === 'win32'
  const a = path.resolve(p)
  const b = path.resolve(folder)
  const [x, y] = fold ? [a.toLowerCase(), b.toLowerCase()] : [a, b]
  return x === y || x.startsWith(y.endsWith(path.sep) ? y : y + path.sep)
}

/** The folders that exist. */
export const existingDirs = (/** @type {string[]} */ dirs) => dirs.filter((d) => existsSync(d))

const CHUNK = 1 << 20
const NEWLINE = 10

/**
 * Read the complete lines of a file from a byte offset, synchronously and in 1 MB chunks. Lines are handed over as
 * Buffers, so a long line that is not wanted is never turned into a string.
 * @param {string} file
 * @param {number} from  the byte offset to start at; must be the start of a line
 * @param {(line: Buffer) => void} onLine
 * @returns {{ offset: number, rest: Buffer, size: number }}  offset: where the unfinished last line starts; rest: that line
 */
export function readLines(file, from, onLine) {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    /** @type {Buffer[]} */
    let pieces = []
    let pending = 0
    let pos = from
    while (pos < size) {
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK, size - pos))
      const got = readSync(fd, chunk, 0, chunk.length, pos)
      if (got <= 0) break
      pos += got
      const buf = got < chunk.length ? chunk.subarray(0, got) : chunk
      let start = 0
      let nl
      while ((nl = buf.indexOf(NEWLINE, start)) !== -1) {
        const part = buf.subarray(start, nl)
        onLine(pieces.length ? Buffer.concat([...pieces, part]) : part)
        pieces = []
        pending = 0
        start = nl + 1
      }
      if (start < buf.length) {
        pieces.push(buf.subarray(start))
        pending += buf.length - start
      }
    }
    return { offset: pos - pending, rest: Buffer.concat(pieces), size }
  } finally {
    closeSync(fd)
  }
}

/**
 * Hand each line of a buffer to onLine, the last one too.
 * @param {Buffer} buf
 * @param {(line: Buffer) => void} onLine
 */
export function splitLines(buf, onLine) {
  let start = 0
  let nl
  while ((nl = buf.indexOf(NEWLINE, start)) !== -1) {
    onLine(buf.subarray(start, nl))
    start = nl + 1
  }
  if (start < buf.length) onLine(buf.subarray(start))
}

/**
 * Every line of a file, the last one too even with no newline after it.
 * @param {string} file
 * @param {(line: Buffer) => void} onLine
 */
export function eachLine(file, onLine) {
  const { rest } = readLines(file, 0, onLine)
  if (rest.length) onLine(rest)
}
