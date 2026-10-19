# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a wrong number

None of the tools documents its session format, and they change now and then, so the most useful report is
one that shows the numbers ReRead got. Please include:

- `reread --version` (or the extension's version), the version of the tool you used (`claude --version`,
  `codex --version` or `agy --version`), your operating system and Node.js version;
- the output of `npx reread-cli --json --anon --days 7` (it has no conversation text and, with `--anon`, no project
  names or branches; check it before you paste it);
- what you expected instead.

Please never attach a session `.jsonl` file: it holds your whole conversation.

## Setting up

Node.js 20 or newer.

```
git clone https://github.com/tecyfyai/reread.git
cd reread
npm install           # development tools only; ReRead itself has no dependencies
npm test              # unit tests and the CLI on made-up session files
npm run lint          # ESLint, Prettier and the TypeScript check of the JSDoc types
npm run preview       # the report with sample data, written to your temp folder
node bin/reread.js    # run your working copy on your own sessions
```

## How the code is laid out

| File                               | What it does                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/reread.js`                    | the command; calls `src/cli.js`                                                                                                        |
| `src/cli.js`                       | the help text and the order of things                                                                                                  |
| `src/args.js`                      | parses and checks the options                                                                                                          |
| `src/tools.js`                     | the list of tools: their folders, files, reader and advice; finds the session files                                                    |
| `src/files.js`                     | walks folders and reads files line by line                                                                                             |
| `src/claude.js`                    | reads Claude Code's session files                                                                                                      |
| `src/codex.js`                     | reads Codex's session files                                                                                                            |
| `src/antigravity.js`               | reads Antigravity's conversations                                                                                                      |
| `src/prices.js`                    | the price table and what a reply costs                                                                                                 |
| `src/analyze.js`                   | walks each session: rebuilds, compactions, totals; builds the data every output uses                                                   |
| `src/findings.js`                  | the key findings                                                                                                                       |
| `src/render.js`                    | the terminal summary, Markdown and CSV                                                                                                 |
| `src/report.js`, `src/report.html` | the browser report: the page, and how the data goes into it                                                                            |
| `src/statusline.js`                | the status line, with its cache                                                                                                        |
| `src/format.js`, `src/meta.js`     | number formats; the version and home page                                                                                              |
| `vscode/`                          | the VS Code extension: `src/extension.js` (the editor), `src/core.js` (what it shows), `src/worker.js` (reads off the editor's thread) |

The report page reads its numbers from one JSON block; `npx reread-cli --json` prints the same shape without the
per-reply points. Every rule is described in [docs/how-it-counts.md](docs/how-it-counts.md); a change to a rule
changes that page too.

## Pull requests

- Keep ReRead free of runtime dependencies and network requests, and never read or print conversation text.
- Add or change a test for each change in behaviour (`test/units.test.js` for a module, `test/cli.test.js` for the
  command). Tests build their own session files with `test/helpers.js`; never add real session data.
- Run `npm run lint` and `npm test` before you push. `npm run format` fixes formatting.
- Add a line under "Unreleased" in [CHANGELOG.md](CHANGELOG.md).

## Adding a tool

Write a reader in its own file (see `src/codex.js`): which files are its sessions, and a function that turns one file
into `{ id, sub, cwd, branch, calls }`, keeping only token counts. Add one entry for it to `TOOLS` in `src/tools.js`
and its name to `DISPLAY_ORDER`; the options, folders, breakdowns and advice all read that list. Add its rows to the
price table, a test with a made-up file in `test/cli.test.js`, and a section in `docs/how-it-counts.md`.

## Updating prices

The price table is at the top of `src/prices.js`, from
[Anthropic's](https://platform.claude.com/docs/en/about-claude/pricing) and
[OpenAI's](https://developers.openai.com/api/docs/pricing) and
[Google's](https://ai.google.dev/gemini-api/docs/pricing) pricing pages. Change or add a row, update the
date in the comment above it, add a CHANGELOG line, and run `npm test`.

## Releasing

1. Move the "Unreleased" lines in CHANGELOG.md under the new version and date.
2. `npm version <patch|minor|major>` (the version lives only in package.json).
3. `git push --follow-tags`, then `npm publish` (it runs the lint and tests first).

The extension has its own version and changelog in `vscode/`. Its build copies ReRead's code from `src/` into one file,
so a fix there reaches both. To release it:

1. Update `vscode/CHANGELOG.md` and the version in `vscode/package.json`.
2. In `vscode/`: `npm ci` and `npm run check`. Its logic is tested with the rest in `test/units.test.js`.
3. `npx vsce package --no-dependencies`, then `npx vsce publish --packagePath <file>.vsix` (publisher `hamperpick`).
