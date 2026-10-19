// @ts-check
// The browser report: one self-contained HTML file. The page's own script reads the numbers from a JSON block.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const TEMPLATE = new URL('./report.html', import.meta.url)
const PLACEHOLDER = '__REREAD_DATA__'

/**
 * Put the data into the report page.
 *
 * The data goes into a `<script type="application/json">` block, with `<`, U+2028 and U+2029 escaped so no string in
 * it can end that block. The page's security policy allows only its own script, by hash, so even a name that got
 * past the escaping could not run as code.
 * @param {string} template  the contents of report.html
 * @param {unknown} data
 */
export function buildReport(template, data) {
  if (!template.includes(PLACEHOLDER)) throw new Error(`the report template has no ${PLACEHOLDER} placeholder`)
  const script = /<script>([\s\S]*?)<\/script>/.exec(template)
  if (!script) throw new Error('the report template has no inline script')
  const hash = createHash('sha256').update(script[1], 'utf8').digest('base64')
  const csp = "script-src 'unsafe-inline'"
  if (!template.includes(csp)) throw new Error(`the report template's security policy has no ${csp}`)
  const json = JSON.stringify(data).replace(
    /[<\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  return template.replace(csp, () => `script-src 'sha256-${hash}'`).replace(PLACEHOLDER, () => json)
}

/**
 * Write the report. With no file, it goes in a new folder in the temp directory that only this user can read, so
 * no other user can read it or put a file in its place.
 * @param {string} html
 * @param {string} [file]
 * @returns {string} the path written
 */
export function writeReport(html, file) {
  const target = file ? path.resolve(file) : path.join(mkdtempSync(path.join(tmpdir(), 'reread-')), 'report.html')
  writeFileSync(target, html, { mode: 0o600 })
  return target
}

/** The report template shipped with ReRead. */
export const readTemplate = () => readFileSync(TEMPLATE, 'utf8')

/**
 * Open a file in the default browser. No shell is involved, so no character in the path is read as a command.
 * @param {string} file
 */
export function openFile(file) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [file]]
      : process.platform === 'win32'
        ? ['explorer.exe', [file]]
        : ['xdg-open', [file]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, shell: false })
      .on('error', () => {})
      .unref()
  } catch {
    /* no opener on this system; the path is printed anyway */
  }
}
