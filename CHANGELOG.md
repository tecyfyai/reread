# Changelog

All notable changes to ReRead. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/).

## 0.2.1 - 2026-10-20

- The VS Code extension (`vscode/`, with its own changelog): the prompt cache countdown of the workspace's latest
  Claude Code session in the status bar, and the report in an editor tab, for the workspace or every project. Works in
  Cursor and Antigravity too.
- The report saves its image, JSON and CSV through the editor's save dialog when it is shown in VS Code.
- The README links the extension on Open VSX, for Cursor, Antigravity and other editors that use it.

## 0.2.0 - 2026-10-19

The first public release.

- The share of your Claude Code, Codex and Antigravity usage that went to re-reading context, weighed by API price: reading history from the
  cache, writing history again after the cache was lost, and everything else.
- Rebuilds by reason: the cache went cold, the model changed, or something early in the context changed. Compactions
  are told apart from rebuilds.
- A browser report: key findings, day by day, cost by context size, why the cache was lost, projects, models, and
  sessions with their context reply by reply. Share card, hidden names, JSON and CSV export. Light and dark.
- `reread statusline`: context size, cache countdown and the session's re-read share for Claude Code's status line,
  reading only what was added since its last run.
- Codex sessions (`~/.codex/sessions`, archived ones on Node.js 22.15 or newer) read next to Claude Code's, at
  OpenAI's API prices; `--tool claude|codex|all` and `--by tool`.
- Antigravity conversations (the CLI and the app), priced at the model in Antigravity's settings, since its transcripts
  do not name one; `--tool antigravity`.
- Long-context prices where a model has them (Claude Haiku 5.5 past 100k, OpenAI models past 272k).
- `--json`, `--csv` and `--md` outputs, `--by project|model|tool|day`, `--anon`, `--days`, `--since`, `--project`,
  `--dir`.
- No runtime dependencies and no network requests. Unknown options are errors.
