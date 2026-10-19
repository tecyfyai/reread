// Starts VS Code with the extension and a made-up Claude Code session in a temp folder, then runs suite.cjs inside
// it. Uses the VS Code installed on this machine when VSCODE_PATH names it; otherwise downloads one for the test.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTests } from '@vscode/test-electron'
import { claudeFolderName } from '../../src/claude.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'reread-vscode-')))
const work = path.join(root, 'shop')
const config = path.join(root, 'claude')
const sessions = path.join(config, 'projects', claudeFolderName(work))
mkdirSync(work)
mkdirSync(sessions, { recursive: true })

// Two replies a minute ago: the second reads the first's 12k context from the cache, so the cache is warm.
const now = Date.now()
const reply = (/** @type {number} */ i, /** @type {object} */ usage) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(now - 90e3 + i * 30e3).toISOString(),
    requestId: `req-${i}`,
    cwd: work,
    gitBranch: 'main',
    message: { id: `msg-${i}`, model: 'claude-sonnet-5-5', role: 'assistant', content: [], usage },
  })
writeFileSync(
  path.join(sessions, 'session-1.jsonl'),
  [
    reply(0, { input_tokens: 10, cache_creation_input_tokens: 12000, cache_read_input_tokens: 0, output_tokens: 200 }),
    reply(1, { input_tokens: 10, cache_creation_input_tokens: 300, cache_read_input_tokens: 12000, output_tokens: 90 }),
  ].join('\n') + '\n',
)

await runTests({
  vscodeExecutablePath: process.env.VSCODE_PATH || undefined,
  extensionDevelopmentPath: path.join(here, '..'),
  extensionTestsPath: path.join(here, 'suite.cjs'),
  launchArgs: [work, '--disable-extensions', '--skip-welcome', `--user-data-dir=${path.join(root, 'user')}`],
  extensionTestsEnv: { CLAUDE_CONFIG_DIR: config, CODEX_HOME: path.join(root, 'codex') },
})
