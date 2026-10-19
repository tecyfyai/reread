// Unit tests for each module: node --test
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { analyze, emptyTotals } from '../src/analyze.js'
import { parseArgs, UsageError } from '../src/args.js'
import { findingsOf } from '../src/findings.js'
import { PRICES, priceOf } from '../src/prices.js'
import { csvCell } from '../src/render.js'
import { buildReport, readTemplate } from '../src/report.js'
import { readCodexFile } from '../src/codex.js'
import { callOf, claudeFolderName, latestClaudeSession } from '../src/claude.js'
import { readLines } from '../src/files.js'
import { statusline } from '../src/statusline.js'
import { sessionFiles } from '../src/tools.js'
import { saveRequest, statusView } from '../vscode/src/core.js'
import { folder, MIN, reply, rollout, T0 } from './helpers.js'

describe('parseArgs', () => {
  const NOW = Date.parse('2026-10-19T12:00:00Z')
  const usage = (/** @type {string[]} */ argv, /** @type {RegExp} */ msg) =>
    assert.throws(
      () => parseArgs(argv, NOW),
      (err) => err instanceof UsageError && msg.test(err.message),
    )

  test('mistakes fail with a message instead of being ignored', () => {
    usage(['--dyas', '7'], /unknown option --dyas/)
    usage(['--days'], /--days needs a value/)
    usage(['--days', '--json'], /--days needs a value/)
    usage(['--days', 'x'], /--days takes a number/)
    usage(['--days', '-1'], /--days takes a number/)
    usage(['--days', '7', '--since', '2026-10-01'], /not both/)
    usage(['--top', '2.5'], /--top takes a whole number/)
    usage(['--by', 'week'], /--by takes project, model, tool or day/)
    usage(['--tool', 'cursor'], /--tool takes claude, codex, antigravity or all/)
    usage(['--json', '--csv'], /choose one/)
    usage(['--json=yes'], /unknown option --json/)
    usage(['report'], /unexpected argument report/)
  })
})

describe('prices', () => {
  test('every row has 4 positive prices, a long-context row is dearer, and a 1-hour write costs 2 times input', () => {
    for (const [id, row] of Object.entries(PRICES)) {
      const base = row.slice(0, 4)
      assert.ok(row.length === 4 || row.length === 5, id)
      assert.ok(
        base.every((v) => typeof v === 'number' && v > 0),
        id,
      )
      assert.equal(priceOf(id).write1h, /** @type {number} */ (row[0]) * 2)
      const long = row[4]
      if (long) {
        assert.equal(long.length, 5, id)
        assert.ok(
          long.slice(1).every((v, i) => v >= /** @type {number} */ (base[i])),
          id,
        )
      }
    }
  })

  test('long-context rates apply only past their size', () => {
    assert.equal(priceOf('claude-haiku-5-5', 100e3).input, 0.1)
    assert.equal(priceOf('claude-haiku-5-5', 100e3 + 1).input, 0.5)
    assert.equal(priceOf('gpt-6.1-sol', 272e3).input, 2)
    assert.equal(priceOf('gpt-6.1-sol', 300e3).input, 4)
  })

  test('OpenAI ids: variants keep their model, newer versions do not borrow an older one', () => {
    assert.equal(priceOf('gpt-5.1-codex-max').input, priceOf('gpt-5.1').input)
    assert.equal(priceOf('gpt-5.4-mini').input, 0.75)
    assert.equal(priceOf('gpt-7').input, priceOf('gpt-6.1-sol').input)
    assert.equal(priceOf('claude-opus-4-9').input, priceOf('claude-opus-5-5').input)
  })
})

describe('reading Codex', () => {
  const FILE = 'rollout-2026-01-05T10-00-00-0199a0b1-0000-7000-8000-000000000001.jsonl'

  test('a usage record per response: cached tokens are reads, the rest new input', () => {
    const root = folder({ [FILE]: rollout({ responses: [{ at: 0, input: 5000, cached: 3000, out: 7 }] }) })
    const r = readCodexFile(path.join(root, FILE), 0, new Set())
    assert.equal(r.id, '0199a0b1-0000-7000-8000-000000000001')
    assert.equal(r.cwd, '/work/api')
    assert.equal(r.branch, 'main')
    assert.equal(r.calls.length, 1)
    const { key, ...c } = r.calls[0]
    assert.ok(key.startsWith('codex|resp-'))
    assert.deepEqual(c, { ts: T0, model: 'gpt-6.1-sol', input: 2000, cw5: 0, cw1: 0, read: 3000, out: 7, seen: false })
  })

  test('older files: each new running total in token_count is one response, repeats are not', () => {
    const at = (/** @type {number} */ ms) => new Date(T0 + ms).toISOString()
    const count = (/** @type {number} */ total, /** @type {number} */ input, /** @type {number} */ cached, ms = 0) =>
      JSON.stringify({
        timestamp: at(ms),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { total_tokens: total },
            last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: 10 },
          },
        },
      })
    const root = folder({
      [FILE]: [
        JSON.stringify({ timestamp: at(0), type: 'session_meta', payload: { id: 'x', cwd: '/w/a' } }),
        count(1010, 1000, 0),
        count(1010, 1000, 0),
        count(3030, 2010, 1000, MIN),
      ],
    })
    const calls = readCodexFile(path.join(root, FILE), 0, new Set()).calls
    assert.equal(calls.length, 2)
    assert.equal(calls[1].read, 1000)
    assert.equal(calls[1].input, 1010)
  })
})

describe('reading', () => {
  test('callOf keeps only real replies', () => {
    assert.equal(callOf('not json "usage" "assistant"', 0), null)
    assert.equal(callOf(JSON.stringify({ type: 'user', message: { usage: {} } }) + '"assistant"', 0), null)
    assert.equal(callOf(reply({ id: 1, at: 0, model: '<synthetic>' }), 0), null)
    assert.equal(callOf(reply({ id: 1, at: 0 }), T0 + 1), null)
    const c = callOf(reply({ id: 1, at: 0, input: 5, write: 100, write1h: 50, read: 7, out: 9 }), 0)
    assert.deepEqual(c, {
      key: 'msg-1|req-1',
      ts: T0,
      model: 'claude-sonnet-4-5',
      input: 5,
      cw5: 100,
      cw1: 50,
      read: 7,
      out: 9,
    })
  })

  test('readLines splits across 1 MB chunks and holds back an unfinished line', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'reread-lines-'))
    const file = path.join(dir, 'a.jsonl')
    const long = 'x'.repeat(1.5 * 1024 * 1024) // spans a chunk boundary
    writeFileSync(file, `one\n${long}\nthree\nunfinished`)
    /** @type {string[]} */
    const lines = []
    const r = readLines(file, 0, (b) => lines.push(b.toString()))
    assert.deepEqual(
      lines.map((l) => l.length),
      [3, long.length, 5],
    )
    assert.equal(r.rest.toString(), 'unfinished')
    assert.equal(r.offset, r.size - 'unfinished'.length)
    /** @type {string[]} */
    const again = []
    readLines(file, 4, (b) => again.push(b.toString().slice(0, 1)))
    assert.deepEqual(again, ['x', 't'])
  })
})

describe('findings', () => {
  /** @param {Partial<ReturnType<typeof emptyTotals>>} t */
  const analysis = (t, sessions = 1, buckets = new Map()) => {
    const total = { ...emptyTotals(), ...t }
    const list = Array.from({ length: sessions }, (_, i) => ({
      ...emptyTotals(),
      cost: i < 10 ? total.cost / 20 : total.cost / (2 * (sessions - 10)),
      id: String(i),
      project: '',
      branch: '',
      points: [],
    }))
    return { total, sessions: list, buckets, daily: new Map(), models: new Map() }
  }

  test('each finding appears past its threshold, the costliest first', () => {
    const rebuilds = { cold: { n: 4, cost: 5 }, model: { n: 0, cost: 0 }, prefix: { n: 1, cost: 1 } }
    const buckets = new Map([['200–500k', { calls: 50, usd: 40, readUsd: 30, rebuildUsd: 0 }]])
    const f = findingsOf(analysis({ cost: 100, rebuildCost: 6, rebuilds, compact: { n: 3, ctx: 600e3 } }, 20, buckets))
    assert.deepEqual(
      f.map((x) => x.id),
      ['concentration', 'long-context', 'cache-lost', 'compaction'],
    )
    assert.match(f.find((x) => x.id === 'cache-lost')?.text ?? '', /breaks longer than the cache's life \(4 times\)/)
    assert.equal(f.find((x) => x.id === 'compaction')?.value, '200k')
  })
})

describe('outputs', () => {
  test('csvCell quotes and keeps spreadsheet formulas as text', () => {
    assert.equal(csvCell('plain'), 'plain')
    assert.equal(csvCell('a,b'), '"a,b"')
    assert.equal(csvCell('say "hi"'), '"say ""hi"""')
    assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`)
    assert.equal(csvCell('-rm'), "'-rm")
    assert.equal(csvCell(12.5), '12.5')
  })
})

describe('report page', () => {
  test('data cannot end its script block, and the policy allows only the page script', () => {
    const html = buildReport(readTemplate(), { name: '</script><script>alert(1)</script>\u2028' })
    const block = /<script id="reread-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
    assert.ok(!block.includes('<'))
    assert.ok(!block.includes('\u2028'))
    assert.equal(JSON.parse(block).name, '</script><script>alert(1)</script>\u2028')
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
    const hash = createHash('sha256').update(script).digest('base64')
    assert.ok(html.includes(`script-src 'sha256-${hash}'`))
    assert.ok(!html.includes("'unsafe-inline'; img") && !/script-src[^;]*unsafe-inline/.test(html))
  })
})

describe('statusline', () => {
  const input = (/** @type {string} */ f) => JSON.stringify({ transcript_path: f })

  test('reading on from the cache gives the same line as reading the whole file', () => {
    const root = folder({ 'a.jsonl': [reply({ id: 1, at: 0, write: 50000 })] })
    const file = path.join(root, 'a.jsonl')
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'reread-cache-'))
    const now = T0 + 2 * MIN
    statusline(input(file), { now, cacheDir })
    appendFileSync(file, reply({ id: 2, at: MIN, read: 50000, write: 2000 }) + '\n')
    appendFileSync(file, reply({ id: 3, at: MIN, read: 52000, write: 1000 }).slice(0, 40)) // still being written
    const cached = statusline(input(file), { now, cacheDir })
    assert.equal(cached, statusline(input(file), { now, cacheDir: null }))
    assert.match(cached, /^ctx 52k · cache warm 4:00 · re-read \d+%$/)
  })
})

describe('a workspace (the VS Code extension)', () => {
  test('its latest session and its report take only sessions in its folder or below', () => {
    const at = (/** @type {string} */ cwd) => [reply({ id: cwd, at: 0, write: 5000, cwd })]
    const root = folder({
      [`${claudeFolderName('/work/shop')}/a.jsonl`]: at('/work/shop'),
      [`${claudeFolderName('/work/shop/api')}/b.jsonl`]: at('/work/shop/api'),
      // Its folder name starts like the workspace's, but it ran elsewhere.
      [`${claudeFolderName('/work/shop-old')}/c.jsonl`]: at('/work/shop-old'),
      'rollout-2026-01-05T10-00-00-0199a0b1-0000-7000-8000-000000000001.jsonl': rollout({
        cwd: '/work/shop',
        responses: [{ at: 0, input: 100 }],
      }),
    })
    const old = (/** @type {string} */ f, /** @type {number} */ t) => utimesSync(path.join(root, f), t, t)
    old(`${claudeFolderName('/work/shop')}/a.jsonl`, 1000)
    old(`${claudeFolderName('/work/shop/api')}/b.jsonl`, 2000)
    old(`${claudeFolderName('/work/shop-old')}/c.jsonl`, 3000)

    assert.equal(path.basename(latestClaudeSession(['/work/shop'], { dirs: [root] }) ?? ''), 'b.jsonl')
    assert.equal(latestClaudeSession(['/work/cafe'], { dirs: [root] }), null)

    const folders = ['/work/shop']
    const a = analyze(sessionFiles([root], { since: 0, project: '', tool: 'all', folders }), { since: 0, folders })
    assert.deepEqual(a.sessions.map((x) => x.tool).sort(), ['claude', 'claude', 'codex'])
  })

  test('the status bar counts down, then says cold', () => {
    const s = { model: 'm', ctx: 176e3, lastReply: 0, ttl: 300e3, warmUntil: 300e3, rewriteUsd: 0.88, rereadPct: 44 }
    const s2 = /** @type {any} */ (s)
    assert.equal(statusView(s2, 79e3)?.text, '$(history) 176k · 3:41')
    assert.equal(statusView(s2, 301e3)?.cold, true)
    assert.match(statusView(s2, 301e3)?.tooltip ?? '', /about \$0\.88/)
    assert.equal(statusView(s2, 13 * 3600e3), null)
  })

  test('the report page can ask to save only its own kinds of file', () => {
    const data = `data:text/csv;base64,${Buffer.from('a,b').toString('base64')}`
    assert.equal(saveRequest({ type: 'save', name: 'reread-sessions-2026-10-19.csv', data })?.bytes.toString(), 'a,b')
    assert.equal(saveRequest({ type: 'save', name: '../../.bashrc', data }), null)
    assert.equal(saveRequest({ type: 'save', name: 'reread-2026-10-19.json', data: 'not a data url' }), null)
  })
})
