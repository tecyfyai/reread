// @ts-check
// The command: parse the options, read the sessions, print the chosen output, write the report.
import { existsSync } from 'node:fs'
import { analyze, summarize, withPoints } from './analyze.js'
import { parseArgs, UsageError } from './args.js'
import { VERSION } from './meta.js'
import { renderCsv, renderMarkdown, renderText } from './render.js'
import { buildReport, openFile, readTemplate, TEMPLATE, writeReport } from './report.js'
import { rootsFor, sessionFiles } from './tools.js'
import { statusline } from './statusline.js'

export const HELP = `reread ${VERSION}: how much of your coding agent's usage was re-reading context (Claude Code, Codex, Antigravity)

Usage
  npx reread-cli [options]          summary here, full report in your browser
  reread statusline                 one line for Claude Code's status line (reads its JSON on stdin)

Range
  --days <n>         look back this many days (default 30; 0 = every session file still kept)
  --since <date>     start on this day instead (YYYY-MM-DD, local time)
  --project <text>   only sessions whose project folder contains this text
  --tool <name>      claude, codex, antigravity or all (default all: every tool with sessions here)
  --dir <path>       read the sessions in this folder only

Output
  --text             the summary only; no browser report
  --html [file]      write the report (default: a new private folder in your temp directory)
  --no-open          write the report but do not open it
  --json             all the numbers as JSON
  --csv              every session as CSV
  --md               a Markdown summary, to paste into an issue or a pull request
  --by <what>        add a breakdown to the summary: project, model, tool, effort or day
  --top <n>          sessions in the summary (default 10)
  --anon             replace project names with "project 1", "project 2", ... and leave branches out

  -v, --version      print the version
  -h, --help         this help

Reads only the token counts in your local session files. Nothing is uploaded.`

/**
 * @param {string[]} argv
 * @returns {Promise<number>} the exit status
 */
export async function main(argv) {
  // A closed pipe (reread --json | head) is not an error.
  process.stdout.on('error', (err) => {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EPIPE') process.exit(0)
    throw err
  })
  try {
    return await run(argv)
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`reread: ${err.message}\n`)
      return 1
    }
    const e = /** @type {Error} */ (err)
    process.stderr.write(`reread: ${e.message}\n`)
    if (process.env.REREAD_DEBUG) process.stderr.write(`${e.stack}\n`)
    return 1
  }
}

/** @param {string[]} argv */
async function run(argv) {
  const opts = parseArgs(argv)
  const print = (/** @type {string} */ s) => process.stdout.write(s)

  if (opts.command === 'help') return (print(`${HELP}\n`), 0)
  if (opts.command === 'version') return (print(`${VERSION}\n`), 0)
  if (opts.command === 'statusline') {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    print(`${statusline(input, { color: !process.env.NO_COLOR })}\n`)
    return 0
  }

  const { roots, looked } = rootsFor(opts.tool, opts.dir)
  if (!roots.length) {
    throw new UsageError(
      `no Claude Code, Codex or Antigravity sessions found. Looked in:\n  ${looked.join('\n  ')}\nUse --dir to point at the folder.`,
    )
  }

  const files = sessionFiles(roots, opts)
  const progress = process.stderr.isTTY && opts.format === 'text'
  const a = analyze(files, {
    since: opts.since,
    project: opts.project,
    onProgress: progress ? (n, total) => process.stderr.write(`\rReading ${n} of ${total} session files…`) : undefined,
  })
  if (progress) process.stderr.write('\r\x1b[K')
  if (a.unread.length) {
    process.stderr.write(
      `reread: ${a.unread.length} compressed Codex session ${a.unread.length === 1 ? 'file was' : 'files were'} not read, so their usage is missing: reading them needs Node.js 22.15 or newer (this is ${process.version})\n`,
    )
  }
  if (a.skipped.length) {
    const [first] = a.skipped
    const more = a.skipped.length > 1 ? ` and ${a.skipped.length - 1} more` : ''
    process.stderr.write(`reread: skipped ${first.file} (${first.error})${more}: could not be read\n`)
  }
  if (!a.total.calls) {
    print(`No replies found in ${roots.join(', ')}${opts.since ? ` for ${opts.span}` : ''}.\n`)
    return 0
  }

  const data = summarize(a, { span: opts.span, anon: opts.anon, version: VERSION })
  if (opts.format === 'json') print(`${JSON.stringify(data, null, 2)}\n`)
  else if (opts.format === 'csv') print(renderCsv(data))
  else if (opts.format === 'md') print(renderMarkdown(data, opts))
  else print(renderText(data, { ...opts, color: !!process.stdout.isTTY && !process.env.NO_COLOR }))

  // The browser report: on by default for the summary at a terminal, or asked for with --html.
  const auto = opts.format === 'text' && !opts.text && !!process.stdout.isTTY
  if (opts.html === null && !auto) return 0
  if (!existsSync(TEMPLATE)) {
    if (opts.html !== null) throw new Error(`the report template is missing: ${TEMPLATE.pathname}`)
    return 0
  }
  const file = writeReport(buildReport(readTemplate(), withPoints(a, data)), opts.html || undefined)
  // Next to the summary in the terminal; on stderr when stdout is data.
  const note = (/** @type {string} */ s) => (opts.format === 'text' ? print(s) : process.stderr.write(s))
  const dim = (/** @type {string} */ t) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[2m${t}\x1b[0m` : t)
  const remote = process.env.SSH_CONNECTION || process.env.CI
  if (opts.open && !remote) {
    openFile(file)
    note(`  ${dim('Full report (opened in your browser):')} ${file}\n\n`)
  } else note(`  ${dim('Full report:')} ${file}\n\n`)
  return 0
}
