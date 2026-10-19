# Security

## What ReRead touches

- **Reads** Claude Code's session files (`~/.claude/projects/**/*.jsonl`, or the folder given with `--dir`), and for
  the status line the one file Claude Code names. From each reply it keeps only token counts, the model, the time, the
  ids, the folder name and the git branch. Message text, tool calls and tool results are never kept or printed.
- **Writes** the report: a new folder in your temp directory, readable only by you, or the file you name with
  `--html`. The status line keeps a small cache of token counts in a temp folder that only you can read.
- **Runs** your system's opener (`open`, `xdg-open` or `explorer.exe`) to show the report, without a shell, and not
  when `SSH_CONNECTION` or `CI` is set or `--no-open` is given.
- **Sends nothing.** ReRead makes no network requests and has no runtime dependencies. The report loads no outside
  scripts, fonts or images, and its Content Security Policy allows only its own script, by hash.

Folder and branch names go into the report as plain text, never as HTML, and the CSV exports keep a name that starts
like a spreadsheet formula (`=`, `+`, `-`, `@`) as text.

## Sharing a report

The report contains your project folder names and git branches. Use `--anon`, or **Hide names** in the report, before
you share a report, a screenshot or an export.

## Reporting a vulnerability

Please report security problems privately, through
[GitHub's private vulnerability reporting](https://github.com/tecyfyai/reread/security/advisories/new), not in a public
issue. Include the version (`reread --version`), your operating system and Node.js version, and the steps to reproduce.
You should hear back within a week.

Only the latest release is supported.
