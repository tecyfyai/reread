// Unit tests for each module: node --test
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { analyze, summarize } from '../src/analyze.js'
import { hasPrice, PRICES, priceOf } from '../src/prices.js'
import { csvCell, renderText } from '../src/render.js'
import { buildReport, readTemplate } from '../src/report.js'
import { readCodexFile } from '../src/codex.js'
import { claudeFolderName, latestClaudeSession } from '../src/claude.js'
import { readLines } from '../src/files.js'
import { statusline } from '../src/statusline.js'
import { sessionFiles } from '../src/tools.js'
import { saveRequest } from '../vscode/src/core.js'
import { folder, MIN, reply, rollout, T0 } from './helpers.js'

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
    assert.deepEqual(c, {
      ts: T0,
      model: 'gpt-6.1-sol',
      input: 2000,
      cw5: 0,
      cw1: 0,
      read: 3000,
      out: 7,
      think: 0,
      effort: 'medium',
      seen: false,
    })
  })

  test('reasoning tokens are the thinking part of the output; the effort comes from the turn', () => {
    const lines = rollout({ effort: 'high', responses: [{ at: 0, input: 5000, out: 300, reasoning: 120 }] })
    const root = folder({ [FILE]: lines })
    const [c] = readCodexFile(path.join(root, FILE), 0, new Set()).calls
    assert.equal(c.out, 300)
    assert.equal(c.think, 120)
    assert.equal(c.effort, 'high')
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
  test('a model with no known price shows no cost and no re-read share', () => {
    const root = folder({ 'a.jsonl': [reply({ id: 1, at: 0, write: 50000, model: 'deepseek-chat' })] })
    const line = statusline(input(path.join(root, 'a.jsonl')), { now: T0 + 30 * MIN, cacheDir: null })
    assert.equal(line, 'ctx 50k · cache cold: next reply rewrites 50k')
  })
})

describe('models with no known price', () => {
  test('are counted as replies and tokens, left out of every cost, and named', () => {
    const root = folder({
      'p/a.jsonl': [
        reply({ id: 1, at: 0, write: 5000, out: 100 }),
        reply({ id: 2, at: MIN, model: 'deepseek-chat', input: 3000, out: 200, think: 50 }),
        reply({ id: 3, at: 2 * MIN, model: 'qwen3-coder-plus', input: 1000, out: 100 }),
      ],
    })
    const a = analyze(sessionFiles([root], { since: 0, project: '', tool: 'claude' }), { since: 0 })
    const priced = analyze(
      sessionFiles([folder({ 'p/a.jsonl': [reply({ id: 1, at: 0, write: 5000, out: 100 })] })], {
        since: 0,
        project: '',
        tool: 'claude',
      }),
      { since: 0 },
    )
    assert.equal(a.total.calls, 3)
    assert.equal(a.total.cost, priced.total.cost)
    assert.equal(a.total.thinkCost, 0)
    assert.equal(a.total.unpricedCalls, 2)
    assert.equal(a.total.unpricedTokens, 3000 + 200 + 1000 + 100)
    const data = summarize(a, { span: 'test', anon: false, version: 'test' })
    assert.deepEqual(data.summary.unpriced.models, ['deepseek-chat', 'qwen3-coder-plus'])
    assert.deepEqual(
      data.models.map((m) => [m.model, m.priced]),
      [
        ['claude-sonnet-4-5', true],
        ['deepseek-chat', false],
        ['qwen3-coder-plus', false],
      ],
    )
    assert.match(renderText(data, { top: 0, by: '', color: false }), /2 replies from models with no known price/)
  })

  test('known families and dated ids still have a price', () => {
    for (const m of [
      'claude-opus-5-5',
      'claude-sonnet-4-5-20250929',
      'gpt-6.1-sol',
      'codex-auto-review',
      'gemini-3.8-flash',
    ])
      assert.ok(hasPrice(m), m)
    for (const m of ['', 'deepseek-chat', 'qwen3-coder-plus', 'glm-4.6']) assert.ok(!hasPrice(m), m)
  })
})

describe('thinking and effort', () => {
  test('Claude: thinking counted once per reply, never above its output; effort kept; the finding and breakdown', () => {
    const lines = [
      // One reply written once per content block: the later block has the full counts.
      reply({ id: 1, at: 0, write: 5000, out: 10, think: 400, effort: 'high' }),
      reply({ id: 1, at: 0, write: 5000, out: 1000, think: 800, effort: 'high' }),
      reply({ id: 2, at: MIN, read: 5000, out: 1000, think: 50, effort: 'low' }),
      // No thinking field (an older Claude Code): no thinking counted.
      reply({ id: 3, at: 2 * MIN, read: 5000, out: 1000 }),
    ]
    const root = folder({ 'p/a.jsonl': lines })
    const a = analyze(sessionFiles([root], { since: 0, project: '', tool: 'claude' }), { since: 0 })
    assert.equal(a.total.out, 3000)
    assert.equal(a.total.think, 850)
    const out = priceOf('claude-sonnet-4-5').output
    assert.ok(Math.abs(a.total.thinkCost - (850 * out) / 1e6) < 1e-9)
    assert.deepEqual(
      [...a.efforts.values()].map((e) => [e.tool, e.effort, e.calls, e.think]),
      [
        ['claude', 'high', 1, 800],
        ['claude', 'low', 1, 50],
      ],
    )
  })

  test('a reply listing more thinking than output is capped at its output', () => {
    const root = folder({ 'p/a.jsonl': [reply({ id: 1, at: 0, out: 100, think: 900 })] })
    const a = analyze(sessionFiles([root], { since: 0, project: '', tool: 'claude' }), { since: 0 })
    assert.equal(a.total.think, 100)
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

  test('the report page can ask to save only its own kinds of file', () => {
    const data = `data:text/csv;base64,${Buffer.from('a,b').toString('base64')}`
    assert.equal(saveRequest({ type: 'save', name: 'reread-sessions-2026-10-19.csv', data })?.bytes.toString(), 'a,b')
    assert.equal(saveRequest({ type: 'save', name: '../../.bashrc', data }), null)
    assert.equal(saveRequest({ type: 'save', name: 'reread-2026-10-19.json', data: 'not a data url' }), null)
  })
})
