# ReRead

[![npm](https://img.shields.io/npm/v/reread-cli)](https://www.npmjs.com/package/reread-cli)
[![tests](https://github.com/tecyfyai/reread/actions/workflows/test.yml/badge.svg)](https://github.com/tecyfyai/reread/actions/workflows/test.yml)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

A token usage and prompt cache analyzer for Claude Code, Codex and Antigravity: see how much of your coding agent's
usage was re-reading context, not new work, and why.

```
npx reread-cli
```

It prints a summary and opens a full report in your browser, built on your machine from the session files Claude
Code, Codex and Antigravity already keep. Nothing is uploaded, and it has no dependencies. (The numbers below are sample data.)

```
  52% of your Claude Code usage was re-reading context
  the last 30 days · 120 sessions · 10,551 replies · $515 at API prices

  Reading history from the cache      33.6%  95.2% of all tokens read
  Writing history again               18.7%  after the cache was lost
  Everything else                     47.7%  new input, first cache writes, output
  Of which thinking                    5.9%  27% of output tokens
```

Every reply in a session sends the whole conversation to the model again. Prompt caching makes those re-reads
cheaper, but in a long session they still add up, and when the cache is lost the whole history is written again at
full price. ReRead shows you the split, when and why the cache was lost, and which sessions cost the most.

Every tool with sessions on your machine is read; `--tool claude`, `--tool codex` or `--tool antigravity` picks one. Needs Node.js 20 or newer (22.15 or newer also reads Codex's compressed sessions; on an older Node.js, ReRead says how many it had to skip).

## The report

![The ReRead report, made from sample data](https://raw.githubusercontent.com/tecyfyai/reread/main/docs/report.png)

- **Key findings** first: a few cards, the costliest first, each with one number, what it means and what to do
  (how much of your usage came from long contexts, how concentrated it is in a few sessions, what losing the cache
  cost and why, how large your context grew before each compaction, how much of your usage was thinking).
- **The split**: re-reading from the cache, history written again, and everything else.
- **By day**: what each day cost and how much of it was re-reading.
- **By context size**: how much of your usage came from replies with a large context (over 150k is where it adds up).
- **Why the cache was lost**: a break longer than its life (5 minutes or 1 hour), a model switch mid-session, or a
  change near the start of the context (tools, MCP servers, settings).
- **By project and by model**, and by tool when you use more than one.
- **By effort level**: the cost of each tool's effort levels, and how much of their output was thinking.
- **Sessions**: the 10 costliest, sortable and searchable across all of them, with their git branch. Open one to see
  its context grow reply by reply, with each rebuild and compaction marked.
- **Share**: copy a line of text, or save an image card with no project names on it. Hide names in the whole report
  with one switch before a screenshot.
- **Export** the numbers as JSON or the sessions as CSV.

The report is one HTML file, written to a new folder in your temp directory that only you can read (or to the file
you name with `--html`). It works offline, in light and dark mode.

## Cache countdown in your status line

`reread statusline` (Claude Code only) prints one line for Claude Code's status line: the context size, how long the cache stays warm,
and the session's re-read share. When the cache has gone cold, it says what the next reply will cost to write the
history again, so you can decide to compact or start fresh first.

```
ctx 176k · cache warm 3:41 · re-read 44%
ctx 176k · cache cold: next reply rewrites 176k (~$0.88) · re-read 44%
```

```
npm install -g reread-cli
```

Then add it to `~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "reread statusline" }
}
```

More in [docs/statusline.md](docs/statusline.md).

## In VS Code

The [ReRead extension](vscode/README.md) shows the same countdown in the editor's status bar, for the latest Claude Code
session in your workspace, whether Claude Code runs in the terminal or in the editor. Click it for the report of that
workspace, in an editor tab. Install it from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hamperpick.reread), or from
[Open VSX](https://open-vsx.org/extension/hamperpick/reread) for Cursor, Antigravity and other editors that use it.

## Options

```
npx reread-cli [options]

Range
  --days <n>         look back this many days (default 30; 0 = every session file still kept)
  --since <date>     start on this day instead (YYYY-MM-DD, local time)
  --project <text>   only sessions whose project folder contains this text
  --tool <name>      claude, codex, antigravity or all (default all: every tool with sessions here)
  --dir <path>       read the sessions in this folder only

Output
  --text             the summary only; no browser report
  --html [file]      write the report (default: a new private folder in your temp directory)
  --no-open          write the report but do not open it
  --json             all the numbers as JSON
  --csv              every session as CSV
  --md               a Markdown summary, to paste into an issue or a pull request
  --by <what>        add a breakdown to the summary: project, model, tool, effort or day
  --top <n>          sessions in the summary (default 10)
  --anon             replace project names with "project 1", "project 2", ... and leave branches out
```

Examples:

```
npx reread-cli --days 7 --by model          # this week, by model
npx reread-cli --by effort                  # cost and thinking share by effort level
npx reread-cli --tool codex                 # Codex sessions only
npx reread-cli --project api --text         # one project, terminal only
npx reread-cli --json | jq .summary         # the numbers, for your own scripts
npx reread-cli --csv > sessions.csv         # every session, for a spreadsheet
npx reread-cli --md --anon | pbcopy         # a summary to paste, with no project names
```

Over SSH or in CI the report is written but not opened; the path is printed. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are
respected, and `NO_COLOR` turns colour off. An unknown option is an error, so a typo never runs silently with the defaults.

## Private by design

ReRead reads only the token counts, model, time, ids, folder name and git branch of each reply in
`~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl` and Antigravity's
`~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl`. It never keeps or prints what you or the
agent wrote, makes no network requests and has
no dependencies. The report has no outside scripts, fonts or images, and its security policy lets only its own script
run. See [SECURITY.md](SECURITY.md).

## How it counts

Each kind of token is weighed by its API price for the model that read it (input, cache writes, cache reads, output), so the shares match what the same tokens would cost on the API. Subscription plans measure usage
their own way and do not publish it, so treat the percentage as a guide, not your plan's meter.

A reply counts once, in the session that made it, even when a resumed session copies it; a subagent's replies count
toward the session that started it. "Writing history again" is estimated from token counts: a reply whose cache read
fell below half of the previous reply's context while the context did not shrink.

Thinking is the part of the output the model spent reasoning, billed as output: Claude Code records it as
`thinking_tokens` and Codex as `reasoning_output_tokens`, next to the effort level each reply ran at. ReRead shows its
share of output and of usage, and `--by effort` breaks the cost down by tool and effort level. Antigravity's
transcripts record neither, so its replies count no thinking.

The details, with every rule and threshold: [docs/how-it-counts.md](docs/how-it-counts.md). None of the tools documents
its session format, and any may change it; if ReRead reads yours wrong, please
[open an issue](https://github.com/tecyfyai/reread/issues).

Want to see what caching saves for a prompt of your own? The
[prompt caching calculator](https://tecyfy.com/ai-agents/prompt-caching-calculator) prices it on every Claude model.

## FAQ

### Why is my Claude Code usage so high?

Mostly because every reply sends the whole conversation again. In a session with 150k tokens of context, each reply
re-reads those 150k tokens, so a long session costs far more per reply than a short one. Run ReRead to see how much of
your usage that was, and which sessions drove it.

### Does Claude Code cache prompts?

Yes. Claude Code uses prompt caching on its own, so the history each reply sends again is usually read from the cache,
at a fraction of the normal input price. The cache lasts 5 minutes after its last use (or 1 hour for the longer
cache), and each model has its own.

### Why was my cache rebuilt?

For one of three reasons: a break longer than the cache's life, a switch of model in the middle of a session, or a
change near the start of the context (tools, MCP servers, settings) while the cache was warm. When that happens the
whole history is written to the cache again, at the cache-write price. ReRead counts each case and shows where it
happened in each session.

### Does it work with Codex?

Yes. ReRead reads Codex's session files (`~/.codex/sessions`, or `$CODEX_HOME/sessions`) next to Claude Code's, prices
them at OpenAI's API prices, and shows both together or one with `--tool codex`. Codex also caches the history on its
own, so the same question applies: how much of each reply went to re-reading it.

### Does it work with Antigravity or Gemini CLI?

With Antigravity, yes: the CLI (`agy`) and the app. Antigravity records each reply's tokens but not which model gave
it, so ReRead prices its replies at the model in Antigravity's settings (Gemini 3.8 Flash if none is set); the shares
stay right whatever the model. Gemini CLI was retired for individual users in June 2026 in favour of Antigravity CLI,
so ReRead does not read it.

### How much of my Claude Code usage is thinking?

ReRead shows it directly. Claude Code records the thinking tokens of each reply and the effort level it ran at, and
Codex records its reasoning tokens the same way. ReRead adds them up as a share of your output and of your usage, and
`--by effort` shows the cost and thinking share of each effort level. Thinking is billed as output, so on a high
effort level it can be a large part of each reply's price; a lower level (`claude --effort low`, or
`model_reasoning_effort` in Codex's `config.toml`) suits routine tasks.

### What about DeepSeek, Qwen or other models?

When a coding agent ReRead reads runs a model it has no price for, such as a DeepSeek or Qwen model run through Claude
Code, ReRead counts those replies and their tokens, leaves them out of every cost and share rather than guess a price,
and names the models in the summary and the report.

### How is ReRead different from ccusage?

[ccusage](https://github.com/ccusage/ccusage) reports how many tokens you used and what they cost, by day, month or
session. ReRead explains why: how much of it was re-reading history, when and why the cache was lost, and how much came
from long contexts, with advice for each. They read the same local files and work well side by side.

### Does it work with a Claude Pro or Max plan, or ChatGPT Plus or Pro?

Yes. ReRead reads the session files kept on your machine with any plan or API key. Plans measure usage
their own way, so the dollar figures are what the same tokens would cost on the API; the shares are what matter.

### Does ReRead upload anything?

No. It reads only token counts from local files, makes no network requests and has no dependencies. See
[Private by design](#private-by-design).

## Related

[Agent Chime](https://marketplace.visualstudio.com/items?itemName=hamperpick.agent-chime) (also on
[Open VSX](https://open-vsx.org/extension/hamperpick/agent-chime)) plays a sound in VS Code or Cursor when Claude Code,
Codex, Cursor's agent or Antigravity CLI finishes or needs your approval, so you can return before the prompt cache goes
cold.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT. ReRead is independent and not made, endorsed or supported by Anthropic, OpenAI or Google.
