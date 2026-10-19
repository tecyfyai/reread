#!/usr/bin/env node
// ReRead: how much of your coding agent's usage was re-reading context.
import { main } from '../src/cli.js'

process.exitCode = await main(process.argv.slice(2))
