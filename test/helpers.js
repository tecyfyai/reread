// Made-up session files for the tests.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const T0 = Date.parse('2026-01-05T10:00:00Z')
export const MIN = 60e3

/**
 * One reply line as Claude Code writes it, with only the fields ReRead reads (and some text it must never read).
 * @param {{ id: number | string, at: number, model?: string, input?: number, write?: number, write1h?: number,
 *   read?: number, out?: number, cwd?: string, branch?: string }} r
 */
export function reply({
  id,
  at,
  model = 'claude-sonnet-4-5',
  input = 10,
  write = 0,
  write1h = 0,
  read = 0,
  out = 100,
  cwd = '/work/shop',
  branch = 'main',
}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(T0 + at).toISOString(),
    requestId: `req-${id}`,
    cwd,
    gitBranch: branch,
    message: {
      id: `msg-${id}`,
      model,
      role: 'assistant',
      content: [{ type: 'text', text: 'never read' }],
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: write + write1h,
        cache_read_input_tokens: read,
        output_tokens: out,
        cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: write1h },
      },
    },
  })
}

/**
 * A temp folder with the given files, each a list of lines.
 * @param {Record<string, string[]>} files
 */
export function folder(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'reread-test-'))
  for (const [name, lines] of Object.entries(files)) {
    const file = path.join(root, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, lines.join('\n') + '\n')
  }
  return root
}

/**
 * A Codex session file's lines: its header, the model, and one usage record per response.
 * @param {{ id?: string, cwd?: string, branch?: string, model?: string,
 *   responses: { at: number, input: number, cached?: number, out?: number }[] }} s
 */
export function rollout({
  id = '0199a0b1-0000-7000-8000-000000000001',
  cwd = '/work/api',
  branch = 'main',
  model = 'gpt-6.1-sol',
  responses,
}) {
  const at = (/** @type {number} */ ms) => new Date(T0 + ms).toISOString()
  return [
    JSON.stringify({ timestamp: at(0), type: 'session_meta', payload: { id, cwd, git: { branch } } }),
    JSON.stringify({ timestamp: at(0), type: 'turn_context', payload: { model } }),
    ...responses.map((r, i) =>
      JSON.stringify({
        timestamp: at(r.at),
        type: 'token_usage_record',
        ordinal: i,
        payload: {
          response_id: `resp-${id}-${i}`,
          usage: {
            input_tokens: r.input,
            cached_input_tokens: r.cached ?? 0,
            output_tokens: r.out ?? 50,
            reasoning_output_tokens: 0,
            total_tokens: r.input + (r.out ?? 50),
          },
        },
      }),
    ),
    JSON.stringify({ timestamp: at(0), type: 'response_item', payload: { type: 'message', content: 'never read' } }),
  ]
}
