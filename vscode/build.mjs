// Builds the extension into dist/: the extension and its worker as CommonJS (which every VS Code, Cursor and
// Antigravity version loads), with ReRead's own code from ../src, and the report page next to them.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, 'dist')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist)

await build({
  entryPoints: { extension: path.join(here, 'src/extension.js'), worker: path.join(here, 'src/worker.js') },
  outdir: dist,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  // ReRead finds its report page and package.json from import.meta.url; in the bundle that is the bundle's own file.
  define: { 'import.meta.url': '__rereadUrl' },
  banner: { js: "const __rereadUrl = require('node:url').pathToFileURL(__filename).href;" },
  legalComments: 'none',
  logLevel: 'warning',
})

copyFileSync(path.join(here, '../src/report.html'), path.join(dist, 'report.html'))
// The package needs the licence beside its package.json; the one at the top of the repo is the only copy kept.
copyFileSync(path.join(here, '../LICENSE'), path.join(here, 'LICENSE'))
