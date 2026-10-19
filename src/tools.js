// @ts-check
// The coding agents ReRead reads. Each is one entry here plus a reader in its own file; adding a tool is a new entry and
// a new reader, and every option, folder list, breakdown and piece of advice picks it up from this list.
import { statSync } from 'node:fs'
import path from 'node:path'
import { antigravityDirs, isAntigravityFile, isAntigravityOther, readAntigravityFile } from './antigravity.js'
import { claudeDirs, claudeFolderName, readClaudeFile } from './claude.js'
import { codexDirs, isCodexFile, readCodexFile } from './codex.js'
import { existingDirs, filesUnder } from './files.js'

/**
 * What a reader gives for one session file.
 * @typedef {object} Read
 * @property {string} id      the session it belongs to
 * @property {boolean} sub    a subagent's file, counted toward its session but not drawn in its chart
 * @property {string} cwd     the folder it ran in, or ''
 * @property {string} branch  its git branch, or ''
 * @property {import('./prices.js').Call[]} calls  its replies, oldest first
 */

/**
 * @typedef {object} ToolInfo
 * @property {string} name   for people
 * @property {string} fresh  how to start fresh in it, for the compaction advice
 * @property {() => string[]} dirs  where it keeps sessions
 * @property {boolean} [firstDirOnly]  the folders are alternatives: read the first that exists
 * @property {(file: string) => boolean} owns  whether a file is one of its sessions
 * @property {(file: string) => boolean} [ignores]  a file in its folders that is not a session
 * @property {(file: string, since: number, seen: Set<string>) => Read} read
 * @property {boolean} [projectInPath]  its folder names hold the project, so --project filters paths
 * @property {(cwd: string) => string} [folderName]  the name of the folder it keeps a project's sessions in
 */

/** In the order a file is matched: the more specific names first, Claude Code's plain .jsonl last. */
export const TOOLS = /** @type {const} */ ({
  codex: {
    name: 'Codex',
    fresh: '/new in Codex',
    dirs: () => codexDirs(),
    owns: isCodexFile,
    read: readCodexFile,
  },
  antigravity: {
    name: 'Antigravity',
    fresh: 'a new conversation in Antigravity',
    dirs: () => antigravityDirs(),
    owns: isAntigravityFile,
    ignores: isAntigravityOther,
    read: readAntigravityFile,
  },
  claude: {
    name: 'Claude Code',
    fresh: '/clear in Claude Code',
    dirs: () => claudeDirs(),
    firstDirOnly: true,
    owns: (/** @type {string} */ f) => f.endsWith('.jsonl'),
    read: readClaudeFile,
    projectInPath: true,
    folderName: claudeFolderName,
  },
})
/** @typedef {keyof typeof TOOLS} Tool */

/** @type {Tool[]} */
export const TOOL_IDS = /** @type {Tool[]} */ (Object.keys(TOOLS))

/** @type {Record<Tool, ToolInfo>} */
const INFO = TOOLS

/** In the order people see them. */
export const DISPLAY_ORDER = /** @type {Tool[]} */ (['claude', 'codex', 'antigravity'])

/**
 * Which tool wrote a session file, or null for a file that is not a session.
 * @param {string} file
 * @returns {Tool | null}
 */
export function toolOf(file) {
  for (const id of TOOL_IDS) {
    if (INFO[id].owns(file)) return id
    if (INFO[id].ignores?.(file)) return null
  }
  return null
}

/**
 * The session folders to read for the chosen tool, or the one folder given with --dir.
 * @param {'all' | Tool} tool
 * @param {string} [dir]
 * @returns {{ roots: string[], looked: string[] }}
 */
export function rootsFor(tool, dir) {
  if (dir) return { roots: existingDirs([dir]), looked: [dir] }
  const ids = tool === 'all' ? TOOL_IDS : [tool]
  const looked = ids.flatMap((id) => INFO[id].dirs())
  const roots = ids.flatMap((id) => {
    const found = existingDirs(INFO[id].dirs())
    return INFO[id].firstDirOnly ? found.slice(0, 1) : found
  })
  return { roots, looked }
}

/**
 * The session files to read: changed at or after `since`, of the chosen tool, oldest first, so a reply copied into a
 * resumed session is counted in the session that made it. Where a tool's folder names hold the project, `project`
 * and `folders` filter paths here; the other tools name the folder inside, so analyze() filters those.
 * @param {string[]} roots
 * @param {{ since: number, project: string, tool: 'all' | Tool, folders?: string[] }} filter
 */
export function sessionFiles(roots, { since, project, tool, folders = [] }) {
  const needle = project.toLowerCase()
  /** @param {Tool} t @param {string} root @param {string} f */
  const inFolders = (t, root, f) => {
    const name = INFO[t].folderName
    if (!folders.length || !name) return true
    const top = path.relative(root, f).split(path.sep)[0]
    return folders.some((d) => top === name(d) || top.startsWith(`${name(d)}-`))
  }
  /** @type {[string, number, number][]} */
  const found = []
  for (const root of roots) {
    for (const f of filesUnder(root, (p) => toolOf(p) !== null)) {
      const t = /** @type {Tool} */ (toolOf(f))
      if (tool !== 'all' && t !== tool) continue
      if (needle && INFO[t].projectInPath && !path.relative(root, f).toLowerCase().includes(needle)) continue
      if (!inFolders(t, root, f)) continue
      let st
      try {
        st = statSync(f)
      } catch {
        continue // gone since the walk
      }
      if (st.mtimeMs >= since) found.push([f, st.birthtimeMs, st.mtimeMs])
    }
  }
  return found.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([f]) => f)
}
