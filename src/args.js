// @ts-check
// The command line: parsed strictly, so a typo fails with a message instead of being ignored.

import { DISPLAY_ORDER, TOOL_IDS } from './tools.js'

/** A mistake in the command line. The CLI prints its message and exits with status 1. */
export class UsageError extends Error {}

/**
 * @typedef {object} Options
 * @property {'report' | 'statusline' | 'help' | 'version'} command
 * @property {number} since      only replies at or after this time (ms since 1970); 0 for all
 * @property {string} span       the period in words: 'the last 30 days', 'since 2026-10-01', 'all your sessions'
 * @property {string} project    only sessions whose project folder contains this text
 * @property {string} dir        the sessions folder given with --dir, or ''
 * @property {'all' | import('./tools.js').Tool} tool  whose sessions to read
 * @property {'text' | 'json' | 'csv' | 'md'} format
 * @property {'' | 'project' | 'model' | 'day' | 'tool'} by
 * @property {number} top        sessions in the summary
 * @property {string | null} html  null: decide by the terminal; '': a file in a private temp folder; else this path
 * @property {boolean} text      --text: the summary only
 * @property {boolean} open      open the report in the browser
 * @property {boolean} anon      replace project names and leave branches out
 */

const WITH_VALUE = new Set(['--days', '--since', '--project', '--dir', '--by', '--top', '--tool'])
const SWITCHES = new Set(['--text', '--no-open', '--json', '--csv', '--md', '--anon', '--html'])

/**
 * @param {string[]} argv  the arguments after the script name
 * @param {number} [now]   the current time, for --days
 * @returns {Options}
 */
export function parseArgs(argv, now = Date.now()) {
  /** @type {Map<string, string>} */
  const values = new Map()
  /** @type {Set<string>} */
  const switches = new Set()
  /** @type {string[]} */
  const positional = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') return { ...defaults(), command: 'help' }
    if (arg === '-v' || arg === '--version') return { ...defaults(), command: 'version' }
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq > 0 ? arg.slice(0, eq) : arg
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined
    if (WITH_VALUE.has(name)) {
      const value = inline ?? argv[i + 1]
      if (value === undefined || (inline === undefined && value.startsWith('--'))) {
        throw new UsageError(`${name} needs a value (see --help)`)
      }
      if (inline === undefined) i++
      values.set(name, value)
    } else if (name === '--html') {
      // --html takes an optional file: --html, --html report.html, --html=report.html
      switches.add(name)
      if (inline !== undefined) values.set(name, inline)
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) values.set(name, argv[++i])
    } else if (SWITCHES.has(name) && inline === undefined) {
      switches.add(name)
    } else {
      throw new UsageError(`unknown option ${name} (see --help)`)
    }
  }

  let command = /** @type {Options['command']} */ ('report')
  if (positional[0] === 'statusline') {
    command = 'statusline'
    positional.shift()
  }
  if (positional.length) throw new UsageError(`unexpected argument ${positional[0]} (see --help)`)

  const formats = /** @type {const} */ (['json', 'csv', 'md']).filter((f) => switches.has(`--${f}`))
  if (formats.length > 1) throw new UsageError(`choose one of --json, --csv or --md`)

  const days = values.get('--days')
  const sinceArg = values.get('--since')
  if (days !== undefined && sinceArg !== undefined) throw new UsageError('use --days or --since, not both')

  let since = 0
  let span = 'all your sessions'
  if (sinceArg !== undefined) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sinceArg)
    const date = m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
    if (!m || !date || date.getMonth() !== +m[2] - 1 || date.getDate() !== +m[3]) {
      throw new UsageError('--since takes a date like 2026-10-01')
    }
    since = date.getTime()
    span = `since ${sinceArg}`
  } else {
    const n = days === undefined ? 30 : Number(days)
    if (days !== undefined && (days.trim() === '' || !Number.isFinite(n) || n < 0)) {
      throw new UsageError('--days takes a number of days, such as --days 7')
    }
    if (n > 0) {
      since = now - n * 86400e3
      span = n === 1 ? 'the last day' : `the last ${n} days`
    }
  }

  const topArg = values.get('--top')
  const top = topArg === undefined ? 10 : Number(topArg)
  if (!Number.isInteger(top) || top < 0) throw new UsageError('--top takes a whole number, such as --top 20')

  const by = values.get('--by') ?? ''
  if (by !== '' && by !== 'project' && by !== 'model' && by !== 'day' && by !== 'tool') {
    throw new UsageError('--by takes project, model, tool or day')
  }

  const tool = /** @type {Options['tool']} */ (values.get('--tool') ?? 'all')
  if (tool !== 'all' && !TOOL_IDS.includes(tool)) {
    throw new UsageError(`--tool takes ${DISPLAY_ORDER.join(', ')} or all`)
  }

  return {
    command,
    since,
    span,
    project: values.get('--project') ?? '',
    dir: values.get('--dir') ?? '',
    tool,
    format: formats[0] ?? 'text',
    by,
    top,
    html: switches.has('--html') ? (values.get('--html') ?? '') : null,
    text: switches.has('--text'),
    open: !switches.has('--no-open'),
    anon: switches.has('--anon'),
  }
}

/** @returns {Options} */
function defaults() {
  return {
    command: 'report',
    since: 0,
    span: '',
    project: '',
    dir: '',
    tool: 'all',
    format: 'text',
    by: '',
    top: 10,
    html: null,
    text: false,
    open: true,
    anon: false,
  }
}
