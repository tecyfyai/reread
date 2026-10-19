// @ts-check
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** The version in package.json, the only place it is written. */
export const VERSION = /** @type {string} */ (pkg.version)

/** Where ReRead lives, for links in the outputs. */
export const HOMEPAGE = 'https://github.com/tecyfyai/reread'
