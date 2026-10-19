# How ReRead counts

ReRead turns the token counts in Claude Code's, Codex's and Antigravity's session files into one question: how much of what you used went to
sending the same history again? This page lists every rule, so you can check a number or argue with one.

The code for each part is named in brackets.

## What it reads (`src/claude.js`)

Claude Code writes each session as a JSON Lines file under `~/.claude/projects/<folder>/<session-id>.jsonl` (or under
`$CLAUDE_CONFIG_DIR/projects`). A subagent's replies go in `<session-id>/subagents/*.jsonl`.

ReRead reads only the lines of `type: "assistant"` that carry `message.usage`, and from each one keeps:

| Field                                                    | Used for                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `message.usage.input_tokens`                             | new input                                                            |
| `message.usage.cache_creation_input_tokens`              | cache writes                                                         |
| `message.usage.cache_creation.ephemeral_1h_input_tokens` | the part written to the 1-hour cache; the rest is the 5-minute cache |
| `message.usage.cache_read_input_tokens`                  | cache reads: history sent again at the cache price                   |
| `message.usage.output_tokens`                            | output                                                               |
| `message.model`                                          | the price, and model switches                                        |
| `message.id`, `requestId`                                | counting each reply once                                             |
| `timestamp`                                              | days, and how long the cache was idle                                |
| `cwd` (folder name only), `gitBranch`                    | the project and branch columns                                       |

Replies with the model `<synthetic>` are made by Claude Code itself and are left out. Message text, tool calls and
tool results are never parsed into anything ReRead keeps.

Some replies list 1-hour cache writes in the breakdown while the total says 0. ReRead trusts the breakdown.

## Codex (`src/codex.js`)

Codex writes each session as `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl` (or under `$CODEX_HOME`), and
moves old ones to `archived_sessions/` compressed with zstd, which ReRead reads on Node.js 22.15 or newer. From each file
it keeps:

| Line                                               | Used for                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `session_meta`: `id`, `cwd`, `git.branch`          | the session, project and branch                                             |
| `turn_context`: `model`                            | the price, and model switches                                               |
| `token_usage_record`: `response_id`, `usage`       | one reply per response, counted once by its id                              |
| `event_msg` of type `token_count` (older versions) | used only when a file has no usage records: one reply per new running total |

OpenAI counts cached tokens inside `input_tokens`, so new input is `input_tokens − cached_input_tokens −
cache_write_input_tokens`, cache reads are `cached_input_tokens` and output is `output_tokens` (reasoning included).
OpenAI's cache has no write price, so a rebuild costs input price. Its life is not fixed (minutes, longer when the
service is quiet); ReRead uses 5 minutes to name a rebuild "cache went cold", so treat that reason as approximate for
Codex. `--project` matches the folder a Codex session ran in.

## Antigravity (`src/antigravity.js`)

Antigravity keeps each conversation in `~/.gemini/antigravity-cli/brain/<id>/` (the CLI) or
`~/.gemini/antigravity/brain/<id>/` (the app). ReRead reads `.system_generated/logs/transcript.jsonl` there, where each
step the model took has `input_tokens` (new input), `cache_read_tokens`, `output_tokens` (thinking included) and
`created_at`; the other logs in that folder repeat it. These add up to the usage `agy --output-format json` reports.

The transcript does not say which model answered, so every reply is priced at the model named in Antigravity's
`settings.json`, or Gemini 3.8 Flash. A model switch inside a conversation is not seen, so it is counted as "early
context changed". The folder a conversation ran in is read from its `conversations/<id>.db` with Node.js's SQLite
reader (Node.js 22.13 or newer), or else from Antigravity's list of recent conversations. As with Codex, there is no
cache-write price and the 5-minute cache life is an estimate.

## Counting each reply once

- Claude Code writes a reply once per content block (text, tool call, ...) with the same message id and request id.
  ReRead keeps one per id pair, with the largest output count.
- When you resume or fork a session, Claude Code copies the earlier replies into the new file. Files are read oldest
  first; a reply already seen in an earlier file is used to know the state of the cache but is not counted again.
- A subagent's file counts toward the session in whose folder it sits. Each file is walked on its own, because a
  subagent has its own cache.

## What a reply costs (`src/prices.js`)

Each reply is priced as it would be on the Claude API, in US dollars per million tokens:

```
cost = input × input price
     + 5-minute cache writes × 5-minute write price
     + 1-hour cache writes × 2 × input price
     + cache reads × read price
     + output × output price
```

Prices come from Anthropic's, OpenAI's and Google's pricing pages, with the date they were read at the top of `src/prices.js`.
Where a model charges more past a context size (Claude Haiku 5.5 past 100k tokens, OpenAI's larger models past 272k),
a reply past it is priced at those rates. A model id with
a date (`claude-sonnet-4-5-20250929`) gets its model's price; an id ReRead does not know is priced as the newest model
of its family (opus, sonnet, haiku, or OpenAI's luna, terra and the rest, priced as GPT-6.1 Sol), or as Opus 5.5.

Prices are used only to weigh token kinds against each other: one cache-read token is far cheaper than one output
token, and a share of tokens would hide that. Subscription plans count usage their own way and do not publish it.

## The split

- **Reading history from the cache**: the cost of all cache reads.
- **Writing history again**: the cost of rebuilds (below).
- **Everything else**: new input, first cache writes, cache writes that only add the new turn, and output.

The headline share is the first two together, divided by the total.

## Rebuilds: when the whole history was written again (`src/analyze.js`, `walk`)

Within one file, replies are walked in time order. Each reply's context is `input + cache writes + cache reads`.

A reply is a **rebuild** when all of these hold:

1. the previous reply's context was at least 2,048 tokens (the API caches nothing smaller);
2. the context did not shrink (see compaction below);
3. its cache read fell below half of the previous reply's context.

What it cost: the tokens that had been cached and were written again, `min(previous context, context) − cache read`,
at the price of the write that happened (1-hour, 5-minute, or input when nothing was written).

Why it happened, checked in this order:

| Reason                | Rule                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model changed         | the model differs from the previous reply's. Each model keeps its own cache.                                                                            |
| Cache went cold       | the gap since the previous reply was longer than the cache's life: 5 minutes, or 1 hour once the session has written to the 1-hour cache.               |
| Early context changed | anything else: something near the start of the context changed while the cache was warm, such as the tools, MCP servers, the system prompt or settings. |

## Compaction

A reply whose context is under 60% of the previous one's is a **compaction** or `/clear`: a new, smaller context, not
a re-read and not a rebuild. Compactions of a context of at least 20,000 tokens are counted for the findings.

## Key findings (`src/findings.js`)

Each finding appears only past its threshold, and they are sorted by the dollars they concern.

| Finding                                          | Shown when                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| Your 10 costliest sessions made N% of your usage | at least 15 sessions, and the top 10 made at least 30%                      |
| Replies past 150k context made N% of your usage  | replies with a context of 150k tokens or more made at least 20%             |
| Your context was compacted or cleared N times    | at least 3 compactions                                                      |
| Losing the cache cost $N                         | rebuilds made at least 1% of usage; the advice follows the costliest reason |

## Days and periods

`--days 30` means replies from the last 30 × 24 hours; `--since 2026-10-01` means from midnight of that day in your
time zone. Days in the report are local calendar days, from the first day with a reply to the last.

## Known limits

- None of the tools documents its session format; any may change it between versions.
- Rebuilds are inferred from token counts; Claude Code does not record why the cache missed.
- Replies made outside Claude Code, Codex and Antigravity (the API directly, other tools) are not in these files.
- Session files older than Claude Code keeps (30 days by default, `cleanupPeriodDays` in its settings) are gone, so
  `--days 0` reaches only as far back as the files do.
