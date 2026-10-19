// @ts-check
// Small number helpers shared by the analysis and the outputs.

/** a as a percentage of b, or 0 when b is 0. */
export const pct = (/** @type {number} */ a, /** @type {number} */ b) => (b ? (100 * a) / b : 0)
export const round1 = (/** @type {number} */ v) => Math.round(v * 10) / 10
export const round2 = (/** @type {number} */ v) => Math.round(v * 100) / 100

/** A count in the en-US style: 10,551. */
export const int = (/** @type {number} */ n) => n.toLocaleString('en-US')

/** US dollars: $2.40, or $1,250 from $100 up. */
export const usd = (/** @type {number} */ v) => `$${v >= 100 ? int(Math.round(v)) : v.toFixed(2)}`

/** Tokens: 950, 176k, 1.2M. */
export const tokens = (/** @type {number} */ n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n))

/** The local calendar day of a time, as YYYY-MM-DD. */
export function dayOf(/** @type {number} */ ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
