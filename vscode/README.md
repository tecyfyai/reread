# ReRead for VS Code

See when your Claude Code prompt cache goes cold, right in the status bar, and how much of your coding agent's usage
was re-reading context. Works in VS Code, Cursor, Antigravity and other VS Code based editors. Everything is read from
the session files on your machine; nothing is sent anywhere.

## Cache countdown in the status bar

```
176k · 3:41      the context of the last reply · how long the cache stays warm
176k · cold      the cache has expired: the next reply writes the whole context again
```

Every reply sends the whole conversation to the model again. Prompt caching makes that cheap while the cache is warm:
5 minutes after the last reply, or 1 hour once a session uses the longer cache. After that, the next reply writes the
whole context to the cache again at full price. The countdown shows how long you have, and when it turns cold, the
tooltip says what the next reply will cost, so you can compact or start fresh first.

It follows the latest Claude Code session started in this workspace (or a folder inside it), whether you run Claude
Code in the terminal or in the editor.

## The report

**ReRead: Open Report for This Workspace** (or click the status bar item) opens the ReRead report in an editor tab, for
the sessions in this workspace. **ReRead: Open Report for All Projects** covers every project. The report covers
Claude Code, Codex and Antigravity:

- how much of your usage was re-reading history from the cache, and how much was writing it again after the cache was
  lost;
- when and why the cache was lost (a long break, a model switch, a change near the start of the context);
- how much came from long contexts, by day, by project, by model and by tool;
- how much of your usage was thinking, and what each effort level cost;
- your costliest sessions, each with its context growing reply by reply.

Export the numbers as JSON or CSV, or save a share card with no project names on it.

## Settings

| Setting            | Default | What it does                                                   |
| ------------------ | ------- | -------------------------------------------------------------- |
| `reread.statusBar` | `true`  | Show the cache countdown in the status bar.                    |
| `reread.days`      | `30`    | How many days back the report looks (`0`: every session kept). |

## Private by design

ReRead reads only the token counts, model, time, ids, folder and git branch of each reply in your local session files.
It never reads what you or the agent wrote, makes no network requests, and the report page runs no outside code.

The dollar figures are what the same tokens would cost on the API. Subscription plans measure usage their own way, so
treat them as a guide to where your usage goes, not as your plan's meter.

## Also on the command line

```
npx reread-cli
```

The same report from a terminal, plus a cache countdown for Claude Code's own status line. See
[ReRead on GitHub](https://github.com/tecyfyai/reread).

## Related

[Agent Chime](https://marketplace.visualstudio.com/items?itemName=hamperpick.agent-chime) plays a sound when Claude
Code, Codex, Cursor's agent or Antigravity CLI finishes or needs your approval, so you can return to a session before
its cache goes cold.

ReRead is independent and not made, endorsed or supported by Anthropic, OpenAI or Google. MIT licence.
