#!/usr/bin/env node
// ReRead: how much of your Claude Code usage was re-reading context.
import { main } from '../src/cli.js'

process.exitCode = await main(process.argv.slice(2))
