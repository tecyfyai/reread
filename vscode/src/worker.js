// @ts-check
// Reading session files can take a few seconds when there are many, so it runs here, off the editor's thread.
import { parentPort } from 'node:worker_threads'
import { reportPage, workspaceState } from './core.js'

const port = /** @type {import('node:worker_threads').MessagePort} */ (parentPort)

port.on('message', (/** @type {{ id: number, job: 'state' | 'report', args: any }} */ m) => {
  try {
    const result = m.job === 'state' ? workspaceState(m.args.folders) : reportPage(m.args)
    port.postMessage({ id: m.id, result })
  } catch (err) {
    port.postMessage({ id: m.id, error: /** @type {Error} */ (err).message })
  }
})
