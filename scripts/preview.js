#!/usr/bin/env node
// Fills the report template with sample data, so the page can be checked in a browser without real sessions.
//
//   node scripts/preview.js [data.json] [out.html]
//
// Defaults: scripts/sample-data.json, written to reread-preview.html in your temp folder. The data goes in the
// same way the CLI puts it in.
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildReport, readTemplate } from '../src/report.js'

const dataFile = process.argv[2] ?? new URL('./sample-data.json', import.meta.url)
const outFile = path.resolve(process.argv[3] ?? path.join(tmpdir(), 'reread-preview.html'))

writeFileSync(outFile, buildReport(readTemplate(), JSON.parse(readFileSync(dataFile, 'utf8'))))
console.log(`Wrote ${outFile}`)
