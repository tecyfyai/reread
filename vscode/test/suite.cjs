// Runs inside VS Code (see run.mjs): the status bar shows the made-up session's warm cache, and the report opens.
const assert = require('node:assert/strict')
const vscode = require('vscode')

const sleep = (/** @type {number} */ ms) => new Promise((ok) => setTimeout(ok, ms))

exports.run = async () => {
  const ext = vscode.extensions.getExtension('hamperpick.reread')
  assert.ok(ext, 'the extension is installed')
  const api = await ext.activate()

  let text = ''
  for (let i = 0; i < 50 && !text; i++) {
    await sleep(200)
    text = api.statusText()
  }
  assert.match(text, /^\$\(history\) 12k · [1-4]:\d\d$/)

  // The report's own script runs in the editor tab and tells the extension when it has drawn the page.
  await vscode.commands.executeCommand('reread.openWorkspaceReport')
  for (let i = 0; i < 50 && !api.report().drawn; i++) await sleep(200)
  assert.deepEqual(api.report(), { title: 'ReRead: shop', drawn: true })
}
