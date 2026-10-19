# The status line

`reread statusline` prints one line for Claude Code's status line, about the session you are in:

```
ctx 176k · cache warm 3:41 · re-read 44%
ctx 176k · cache cold: next reply rewrites 176k (~$0.88) · re-read 44%
```

- **ctx**: the context the last reply sent.
- **cache warm m:ss**: how long until the prompt cache expires, counted from the last reply. It is 5 minutes, or 1 hour
  once the session has written to the 1-hour cache. It turns yellow in the last minute.
- **cache cold**: the cache has expired. The next reply writes the whole context again, at the cache-write price; the
  dollar figure is what that costs at API prices. A good moment to `/compact` or start fresh instead.
- **re-read**: the share of this session's usage that went to re-reading history, as in the full report.

## Set it up

Install ReRead once, so the status line does not download it on every redraw:

```
npm install -g reread-cli
```

Then add this to `~/.claude/settings.json` (or a project's `.claude/settings.json`):

```json
{
  "statusLine": { "type": "command", "command": "reread statusline" }
}
```

To show it next to a status line you already have, use a small script that hands the same input to both, and point
`command` at the script:

```sh
#!/bin/sh
input=$(cat)
echo "$(printf '%s' "$input" | my-statusline) · $(printf '%s' "$input" | reread statusline)"
```

## How it works

Claude Code runs the command whenever it redraws the status line and pipes it a JSON object with `transcript_path`,
the current session's file. ReRead reads the token counts in that file (never the text) and works out the cache state
the same way as the full report ([how it counts](how-it-counts.md)).

A session file can grow to hundreds of megabytes. So that each redraw stays fast, ReRead keeps the replies it has read
(token counts and times only) in a small cache file and reads only the bytes added since. The cache lives in a folder
in your temp directory that only you can read (`reread-<your user id>`), and files untouched for 2 days are removed.

The countdown moves when Claude Code redraws the status line, which it does as you work, not every second.

`NO_COLOR` turns colour off.
