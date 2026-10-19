// @ts-check
// What each kind of token costs on the API, used only to weigh token kinds against each other the way the API bill
// does. ReRead never sends anything anywhere; these numbers are a fixed table.
//
// Sources (read 2026-10-19; to update, change the rows, the date here and CHANGELOG.md, then run `npm test`):
//   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI:    https://developers.openai.com/api/docs/pricing
//   Google:    https://ai.google.dev/gemini-api/docs/pricing

/**
 * US dollars per million tokens: [input, cache write, cache read, output], optionally followed by the rates that apply
 * once the context passes a size: [above, input, cache write, cache read, output]. Anthropic's 1-hour cache write
 * costs 2 times input, so it is not listed. Where a maker has no cache-write price, a write costs input; where a model
 * has no cache, a read costs input.
 * @typedef {[number, number, number, number]} Rates
 * @type {Record<string, Rates | [number, number, number, number, [number, number, number, number, number]]>}
 */
export const PRICES = {
  // Anthropic
  'claude-fable-5-1': [10, 12.5, 0.25, 50],
  'claude-mythos-5-1': [10, 12.5, 0.25, 50],
  'claude-fable-5': [10, 12.5, 1, 50],
  'claude-mythos-5': [10, 12.5, 1, 50],
  'claude-opus-5-5': [4, 5, 0.2, 20],
  'claude-opus-5': [5, 6.25, 0.5, 25],
  'claude-opus-4-8': [5, 6.25, 0.5, 25],
  'claude-opus-4-7': [5, 6.25, 0.5, 25],
  'claude-opus-4-6': [5, 6.25, 0.5, 25],
  'claude-opus-4-5': [5, 6.25, 0.5, 25],
  'claude-opus-4-1': [15, 18.75, 1.5, 75],
  'claude-opus-4': [15, 18.75, 1.5, 75],
  'claude-sonnet-5-5': [2, 2.5, 0.1, 10],
  'claude-sonnet-5': [2, 2.5, 0.2, 10],
  'claude-sonnet-4-6': [3, 3.75, 0.3, 15],
  'claude-sonnet-4-5': [3, 3.75, 0.3, 15],
  'claude-sonnet-4': [3, 3.75, 0.3, 15],
  'claude-haiku-5-5': [0.1, 0.125, 0.01, 0.5, [100e3, 0.5, 0.625, 0.05, 2.5]],
  'claude-haiku-4-5': [1, 1.25, 0.1, 5],
  'claude-haiku-3-5': [0.8, 1, 0.08, 4],
  // OpenAI
  'gpt-6-astra': [10, 12.5, 1, 50, [272e3, 20, 25, 2, 75]],
  'gpt-6.1-sol': [2, 2.5, 0.1, 10, [272e3, 4, 5, 0.2, 15]],
  'gpt-6-sol': [2, 2.5, 0.2, 10, [272e3, 4, 5, 0.4, 15]],
  'gpt-6-luna': [0.1, 0.125, 0.01, 0.5, [272e3, 0.2, 0.25, 0.02, 0.75]],
  'gpt-5.6-sol': [4, 5, 0.4, 20, [272e3, 8, 10, 0.8, 30]],
  'gpt-5.6-terra': [2, 2.5, 0.2, 12, [272e3, 4, 5, 0.4, 18]],
  'gpt-5.6-luna': [0.2, 0.25, 0.02, 1.2, [272e3, 0.4, 0.5, 0.04, 1.8]],
  'gpt-5.5': [5, 5, 0.5, 30, [272e3, 10, 10, 1, 45]],
  'gpt-5.5-pro': [30, 30, 30, 180, [272e3, 60, 60, 60, 270]],
  'gpt-5.4': [2.5, 2.5, 0.25, 15, [272e3, 5, 5, 0.5, 22.5]],
  'gpt-5.4-mini': [0.75, 0.75, 0.075, 4.5],
  'gpt-5.4-nano': [0.2, 0.2, 0.02, 1.25],
  'gpt-5.4-pro': [30, 30, 30, 180, [272e3, 60, 60, 60, 270]],
  'gpt-5.2': [1.75, 1.75, 0.175, 14],
  'gpt-5.2-pro': [21, 21, 21, 168],
  'gpt-5.1': [1.25, 1.25, 0.125, 10],
  'gpt-5': [1.25, 1.25, 0.125, 10],
  'gpt-5-mini': [0.25, 0.25, 0.025, 2],
  'gpt-5-nano': [0.05, 0.05, 0.005, 0.4],
  'gpt-5-pro': [15, 15, 15, 120],
  'gpt-4.1': [2, 2, 0.5, 8],
  'gpt-4.1-mini': [0.4, 0.4, 0.1, 1.6],
  'gpt-4.1-nano': [0.1, 0.1, 0.025, 0.4],
  'gpt-4o': [2.5, 2.5, 1.25, 10],
  'gpt-4o-mini': [0.15, 0.15, 0.075, 0.6],
  o3: [2, 2, 0.5, 8],
  'o4-mini': [1.1, 1.1, 0.275, 4.4],
  // Google (Gemini caches on its own, with no write price)
  'gemini-4-argon': [2, 2, 0.1, 10],
  'gemini-3.8-flash': [0.75, 0.75, 0.075, 3.75],
  'gemini-3.6-flash': [0.75, 0.75, 0.075, 3.75],
  'gemini-3.5-flash-lite': [0.3, 0.3, 0.03, 2.5],
  'gemini-3.1-pro-preview': [2, 2, 0.2, 12, [200e3, 4, 4, 0.4, 18]],
  'gemini-3.1-flash-lite': [0.25, 0.25, 0.025, 1.5],
  'gemini-3-flash-preview': [0.5, 0.5, 0.05, 3],
  'gemini-2.5-pro': [1.25, 1.25, 0.125, 10, [200e3, 2.5, 2.5, 0.25, 15]],
  'gemini-2.5-flash': [0.3, 0.3, 0.03, 2.5],
  'gemini-2.5-flash-lite': [0.1, 0.1, 0.01, 0.4],
}

/** For a model id ReRead does not know: the newest model of the family its name names, else FALLBACK_MODEL. */
const FAMILIES = /** @type {const} */ ([
  [/fable/, 'claude-fable-5-1'],
  [/mythos/, 'claude-mythos-5-1'],
  [/opus/, 'claude-opus-5-5'],
  [/sonnet/, 'claude-sonnet-5-5'],
  [/haiku/, 'claude-haiku-5-5'],
  [/^gpt-.*astra/, 'gpt-6-astra'],
  [/^gpt-.*luna/, 'gpt-6-luna'],
  [/^gpt-.*terra/, 'gpt-5.6-terra'],
  [/^(gpt-|o\d|codex)/, 'gpt-6.1-sol'],
  [/^gemini-.*flash-lite/, 'gemini-3.5-flash-lite'],
  [/^gemini-.*flash/, 'gemini-3.8-flash'],
  [/^gemini-.*pro/, 'gemini-3.1-pro-preview'],
  [/^gemini/, 'gemini-4-argon'],
])
export const FALLBACK_MODEL = 'claude-opus-5-5'

// Longest first, so 'gpt-5.4-mini' is tried before 'gpt-5.4'.
const IDS = Object.keys(PRICES).sort((a, b) => b.length - a.length)

/**
 * Whether a model id is a known id, or one with a suffix: a date ('claude-opus-4-1-20250805') or a variant
 * ('gpt-5.1-codex-max'). A newer version is not a suffix: 'claude-opus-4-9' is not 'claude-opus-4', and 'gpt-5.6-x' is
 * not 'gpt-5'.
 * @param {string} model
 * @param {string} id
 */
function isOf(model, id) {
  if (model === id) return true
  if (!model.startsWith(`${id}-`)) return false
  const rest = model.slice(id.length + 1)
  return /^\d{8}(\b|$)/.test(rest) || /^[a-z]/i.test(rest)
}

/**
 * @typedef {{ input: number, write5m: number, write1h: number, read: number, output: number }} Price
 * @typedef {object} Call  One model response: its token counts by kind.
 * @property {string} key    unique id, to count it once
 * @property {number} ts     time, ms since 1970
 * @property {string} model
 * @property {number} input  new input, not read from the cache and not written to it
 * @property {number} cw5    tokens written to the cache (Anthropic's 5-minute cache, or OpenAI's)
 * @property {number} cw1    tokens written to Anthropic's 1-hour cache
 * @property {number} read   tokens read from the cache
 * @property {number} out    output, reasoning included
 * @property {boolean} [seen]  counted already in an earlier file
 */

/** @type {Map<string, { base: Price, long?: { above: number, price: Price } }>} */
const cache = new Map()

/** @param {number[]} r */
const priceFrom = ([input, write5m, read, output]) => ({ input, write5m, write1h: input * 2, read, output })

/**
 * The price of a model id for a reply with a given context size. An unknown id is priced as the newest model of its
 * family, or as FALLBACK_MODEL.
 * @param {string} [model]
 * @param {number} [context]  the reply's context in tokens, for prices that rise past a size
 * @returns {Price}
 */
export function priceOf(model = '', context = 0) {
  let entry = cache.get(model)
  if (!entry) {
    const id =
      IDS.find((k) => isOf(model, k)) ?? FAMILIES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? FALLBACK_MODEL
    const row = PRICES[id]
    const long = row[4]
    entry = {
      base: priceFrom(/** @type {number[]} */ (row.slice(0, 4))),
      long: long ? { above: long[0], price: priceFrom(long.slice(1)) } : undefined,
    }
    cache.set(model, entry)
  }
  return entry.long && context > entry.long.above ? entry.long.price : entry.base
}

/**
 * The tokens a reply sent: new input, cache writes and cache reads.
 * @param {Call} c
 */
export const contextOf = (c) => c.input + c.cw5 + c.cw1 + c.read

/**
 * What a reply would cost on the API, in US dollars.
 * @param {Call} c
 */
export function costOf(c) {
  const p = priceOf(c.model, contextOf(c))
  return (c.input * p.input + c.cw5 * p.write5m + c.cw1 * p.write1h + c.read * p.read + c.out * p.output) / 1e6
}
