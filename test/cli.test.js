// The CLI end to end, on made-up session files in a temp folder: node --test
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { folder, MIN, reply, rollout, T0 } from './helpers.js'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'reread.js')
const run = (root, ...flags) =>
  execFileSync('node', [CLI, '--dir', root, '--days', '0', ...flags], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
const json = (root, ...flags) => JSON.parse(run(root, '--json', ...flags))

test('counts each reply once, even when it is written once per content block', () => {
  const line = reply({ id: 1, at: 0, write: 5000 })
  const data = json(folder({ 'p/a.jsonl': [line, line, line] }))
  assert.equal(data.summary.calls, 1)
  assert.equal(data.summary.sessions, 1)
})

test('cache reads are the re-read share; a warm cache rebuilds nothing', () => {
  const data = json(
    folder({
      'p/a.jsonl': [
        reply({ id: 1, at: 0, write: 10000 }),
        reply({ id: 2, at: 1 * MIN, write: 1000, read: 10000 }),
        reply({ id: 3, at: 2 * MIN, write: 1000, read: 11000 }),
      ],
    }),
  )
  const s = data.summary
  assert.equal(s.rebuilds.cold.count + s.rebuilds.model.count + s.rebuilds.prefix.count, 0)
  assert.equal(s.rebuildShare, 0)
  assert.ok(s.cacheReadShare > 0 && s.cacheReadShare < 100)
  assert.equal(s.rereadShare, s.cacheReadShare)
})

test('a break longer than the 5-minute cache is a cold rebuild', () => {
  const data = json(
    folder({ 'p/a.jsonl': [reply({ id: 1, at: 0, write: 10000 }), reply({ id: 2, at: 10 * MIN, write: 10010 })] }),
  )
  assert.equal(data.summary.rebuilds.cold.count, 1)
  assert.ok(data.summary.rebuildShare > 0)
})

test('switching model mid-session is a model rebuild', () => {
  const data = json(
    folder({
      'p/a.jsonl': [
        reply({ id: 1, at: 0, write: 10000 }),
        reply({ id: 2, at: 1 * MIN, write: 10010, model: 'claude-opus-4-5' }),
      ],
    }),
  )
  assert.equal(data.summary.rebuilds.model.count, 1)
  assert.equal(data.models.length, 2)
})

test('replies copied into a resumed session are counted in the session that made them', () => {
  const first = [reply({ id: 1, at: 0, write: 10000 }), reply({ id: 2, at: MIN, read: 10000, write: 500 })]
  const root = folder({ 'p/a.jsonl': first })
  // Written later, so it is read second.
  writeFileSync(
    path.join(root, 'p/b.jsonl'),
    [...first, reply({ id: 3, at: 2 * MIN, read: 10500, write: 500 })].join('\n'),
  )
  const data = json(root)
  assert.equal(data.summary.calls, 3)
  assert.equal(data.summary.sessions, 2)
})

test('--anon hides project names and branches everywhere', () => {
  const root = folder({
    'p/a.jsonl': [reply({ id: 1, at: 0, write: 10000, cwd: '/work/secret-client', branch: 'acme/merger' })],
  })
  for (const out of [
    run(root, '--json', '--anon'),
    run(root, '--csv', '--anon'),
    run(root, '--md', '--anon'),
    run(root, '--text', '--anon'),
  ]) {
    assert.ok(!out.includes('secret-client'), out)
    assert.ok(!out.includes('acme/merger'), out)
  }
  assert.equal(json(root, '--anon').projects[0].project, 'project 1')
})

test('never prints what was written in the conversation', () => {
  const root = folder({ 'p/a.jsonl': [reply({ id: 1, at: 0, write: 10000 })] })
  for (const flag of ['--json', '--csv', '--md', '--text']) assert.ok(!run(root, flag).includes('never read'))
})

test('statusline shows the context and whether the cache is still warm', () => {
  const root = folder({ 'p/a.jsonl': [reply({ id: 1, at: 0, write: 120000 })] })
  const out = execFileSync('node', [CLI, 'statusline'], {
    input: JSON.stringify({ transcript_path: path.join(root, 'p/a.jsonl') }),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  // The reply is from 2026-01-05, so the cache is long cold.
  assert.match(out, /^ctx 120k · cache cold: next reply rewrites 120k \(~\$0\.\d\d\) · re-read 0%/)
})

test('Codex and Antigravity sessions are read next to Claude Code ones, and --tool picks one', () => {
  const step = (/** @type {number} */ i, /** @type {number} */ input, /** @type {number} */ read) =>
    JSON.stringify({
      step_index: i,
      type: 'PLANNER_RESPONSE',
      created_at: new Date(T0 + i * 1000).toISOString(),
      input_tokens: input,
      cache_read_tokens: read,
      output_tokens: 40,
      content: 'never read',
    })
  const agy = 'brain/c0ffee00-0000-4000-8000-000000000001/.system_generated/logs'
  const root = folder({
    'p/a.jsonl': [reply({ id: 1, at: 0, write: 10000 })],
    'sessions/2026/01/05/rollout-2026-01-05T10-00-00-0199a0b1-0000-7000-8000-000000000001.jsonl': rollout({
      responses: [
        { at: 0, input: 20000 },
        { at: MIN, input: 21000, cached: 20000 },
      ],
    }),
    [`${agy}/transcript.jsonl`]: [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', created_at: new Date(T0).toISOString(), content: 'x' }),
      step(1, 12000, 0),
      step(3, 900, 12000),
    ],
    // Antigravity's other logs repeat the transcript and are not read.
    [`${agy}/transcript_full.jsonl`]: [step(1, 12000, 0)],
  })
  const all = json(root)
  assert.equal(all.product, 'Claude Code, Codex and Antigravity')
  assert.equal(all.summary.sessions, 3)
  assert.equal(all.summary.calls, 5)
  const codex = all.sessions.find((s) => s.tool === 'codex')
  assert.equal(codex.project, 'api')
  assert.equal(codex.id, '0199a0b1')
  assert.ok(codex.rereadShare > 0)
  // Antigravity names no model; it is priced at the model in its settings, Gemini 3.8 Flash when none.
  assert.ok(all.models.some((m) => m.model === 'gemini-3.8-flash' && m.calls === 2))

  const only = json(root, '--tool', 'codex')
  assert.equal(only.product, 'Codex')
  assert.equal(only.summary.calls, 2)
  assert.equal(json(root, '--tool', 'antigravity').summary.calls, 2)
  assert.equal(json(root, '--tool', 'claude').summary.calls, 1)
  assert.match(run(root, '--text', '--by', 'tool'), /By tool[\s\S]*Antigravity/)
  // --project matches a Codex session by the folder it ran in.
  assert.equal(json(root, '--project', 'API').summary.calls, 2)
})
