// @ts-check
// ReRead in VS Code (and Cursor, Antigravity, ...): a status bar countdown of the prompt cache of this workspace's
// latest Claude Code session, and the ReRead report in an editor tab. It reads the same local session files as the
// command, keeps only token counts, and sends nothing anywhere.
import { homedir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import * as vscode from 'vscode'
import { saveRequest, statusView } from './core.js'

/** How often the session file is looked at, and how often the countdown moves. */
const LOOK_EVERY = 3000
const TICK = 1000

/** @typedef {import('./core.js').State} State */

/** @param {vscode.ExtensionContext} context */
export function activate(context) {
  // __dirname is the folder of the built extension.cjs, where worker.cjs sits too.
  const jobs = new Jobs(path.join(__dirname, 'worker.cjs'))
  const item = vscode.window.createStatusBarItem('reread.cache', vscode.StatusBarAlignment.Right, 100)
  item.name = 'ReRead: prompt cache'
  item.command = 'reread.openWorkspaceReport'

  /** @type {State | null} */
  let state = null
  let looking = false
  const folders = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
  const enabled = () => vscode.workspace.getConfiguration('reread').get('statusBar', true)

  const show = () => {
    const view = enabled() ? statusView(state, Date.now()) : null
    if (!view) return item.hide()
    item.text = view.text
    item.tooltip = new vscode.MarkdownString(view.tooltip)
    item.backgroundColor = view.cold ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
    item.show()
  }
  const look = async () => {
    if (!folders().length) state = null
    if (looking || !enabled() || !folders().length) return show()
    looking = true
    try {
      const r = await jobs.run('state', { folders: folders() })
      state = r ? r.state : null
    } catch {
      state = null
    } finally {
      looking = false
    }
    show()
  }

  const lookTimer = setInterval(look, LOOK_EVERY)
  const tickTimer = setInterval(show, TICK)
  void look()

  /** @type {vscode.WebviewPanel | null} */
  let panel = null
  let drawn = false
  /** @param {boolean} workspace */
  const openReport = async (workspace) => {
    const f = workspace ? folders() : []
    const days = Math.max(0, Number(vscode.workspace.getConfiguration('reread').get('days', 30)) || 0)
    const r = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'ReRead: reading sessions' },
      () => jobs.run('report', { days, folders: f }),
    )
    if (!r.html) return void vscode.window.showInformationMessage(`ReRead: ${r.message}`)
    const title = f.length ? `ReRead: ${vscode.workspace.name ?? 'workspace'}` : 'ReRead: all projects'
    if (!panel) {
      panel = vscode.window.createWebviewPanel('reread.report', title, vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [],
      })
      panel.onDidDispose(() => (panel = null))
      panel.webview.onDidReceiveMessage((/** @type {unknown} */ m) => {
        if (/** @type {{ type?: unknown }} */ (m)?.type === 'ready') drawn = true
        else void save(m).catch(failed)
      })
    }
    drawn = false
    panel.title = title
    panel.webview.html = r.html
    panel.reveal()
    return r.replies
  }

  context.subscriptions.push(
    item,
    { dispose: () => (clearInterval(lookTimer), clearInterval(tickTimer), jobs.close()) },
    vscode.commands.registerCommand('reread.openWorkspaceReport', () => openReport(folders().length > 0).catch(failed)),
    vscode.commands.registerCommand('reread.openReport', () => openReport(false).catch(failed)),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('reread') && look()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => look()),
  )

  // For the extension's own tests.
  return {
    statusText: () => (item.text && state ? item.text : ''),
    report: () => ({ title: panel?.title ?? '', drawn }),
  }
}

export function deactivate() {}

/** @param {unknown} err */
function failed(err) {
  vscode.window.showErrorMessage(`ReRead: ${/** @type {Error} */ (err).message}`)
}

/**
 * Save a file the report page made (the share image, the JSON or the CSV export) where the user chooses.
 * @param {unknown} msg
 */
async function save(msg) {
  const req = saveRequest(msg)
  if (!req) return
  const base = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(homedir())
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(base, req.name),
    filters: { [req.ext.toUpperCase()]: [req.ext] },
  })
  if (!uri) return
  await vscode.workspace.fs.writeFile(uri, req.bytes)
  vscode.window.showInformationMessage(`ReRead: saved ${path.basename(uri.fsPath)}`)
}

/** The worker that reads session files, one job at a time, answered in order. */
class Jobs {
  /** @param {string} file */
  constructor(file) {
    this.file = file
    this.next = 0
    /** @type {Map<number, { ok: (v: any) => void, no: (e: Error) => void }>} */
    this.waiting = new Map()
    /** @type {Worker | null} */
    this.worker = null
  }

  start() {
    const w = new Worker(this.file)
    w.on('message', (/** @type {{ id: number, result?: any, error?: string }} */ m) => {
      const p = this.waiting.get(m.id)
      this.waiting.delete(m.id)
      if (m.error !== undefined) p?.no(new Error(m.error))
      else p?.ok(m.result)
    })
    // A worker that dies fails what it was doing; the next job starts a new one.
    const fail = (/** @type {Error} */ err) => {
      for (const p of this.waiting.values()) p.no(err)
      this.waiting.clear()
      if (this.worker === w) this.worker = null
    }
    w.on('error', fail)
    w.on('exit', (code) => fail(new Error(`the reader stopped (${code})`)))
    return w
  }

  /**
   * @param {'state' | 'report'} job
   * @param {object} args
   * @returns {Promise<any>}
   */
  run(job, args) {
    this.worker ??= this.start()
    const id = this.next++
    const w = this.worker
    return new Promise((ok, no) => {
      this.waiting.set(id, { ok, no })
      w.postMessage({ id, job, args })
    })
  }

  close() {
    void this.worker?.terminate()
    this.worker = null
  }
}
