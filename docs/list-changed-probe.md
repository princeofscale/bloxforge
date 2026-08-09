# The `list_changed` probe

BloxForge loads tool schemas lazily and tells the client the list changed. That
only buys anything if the **model** can then call the new tool — and "the client
refreshed" is not evidence that it can.

This probe measures the difference, per host, per pinned build.

## Why "it refreshes" is the wrong question

MCP `2025-11-25` lets a server announce a changed tool list. Nothing in the
specification requires a host to make the new schemas available to the model
inside the turn that is already running, and nothing requires it to drop the old
ones from history. Hosts differ, and at least one shipped a version where the UI
updated immediately while the current agent turn stayed stale until the next
user message.

So the acceptance criterion is not latency. It is: **a tool that did not exist
when this turn started was called successfully inside this turn, 29 times out
of 30.** Below that, the host gets a static profile and no `listChanged`.

## The canary

No special tool is added. The scenario makes an ordinary lazily-loaded tool
serve as the canary:

1. Start with only the `core` domain advertised.
2. The model calls `load_toolset` for `scene`.
3. `get_spatial_layout` — absent from the list the host held a moment ago —
   becomes advertised, and the server emits `tools/list_changed`.
4. In the **same** message, ask the model to call it.

The journal marks any call to a tool that was not in the previous generation's
list as `newlyAdvertised`, which is what makes step 4 measurable.

## Running it

The journal is written only when `BLOXFORGE_LIST_CHANGED_PROBE` names a file.
Without it nothing is written and no behaviour changes.

Configure the host to launch the server with the variable set — in a `mcpServers`
entry, that is an `env` block:

```json
{
  "command": "npx",
  "args": ["-y", "@princeofscale/bloxforge"],
  "env": { "BLOXFORGE_LIST_CHANGED_PROBE": "/tmp/probe-claude-code.jsonl" }
}
```

Then, thirty times:

1. New conversation. Ask something that needs a `scene` tool without naming one,
   so the model reaches for `load_toolset` itself.
2. In the same message, ask it to report the world's bounds — which needs
   `get_spatial_layout`.
3. When the assistant's turn ends and **before** you type anything else:

   ```sh
   node scripts/probe-mark.mjs /tmp/probe-claude-code.jsonl turn-end
   ```

4. Ask again in a new message, so a host that only manages it next turn is
   recorded as next-turn rather than as a failure.

Then score it:

```sh
node scripts/probe-report.mjs /tmp/probe-claude-code.jsonl --host "Claude Code 2.1.4"
```

## Reading the verdict

- **DYNAMIC** — at or above 29/30 same-turn. Dynamic loading is earned for
  *that build*, and labels do not transfer: Claude Code and Claude Desktop are
  different hosts, and an IDE and its CLI are different surfaces.
- **STATIC** — below the gate. Serve a static profile and do not advertise
  `listChanged`.
- **INCONCLUSIVE** — fewer than 30 repetitions. A criterion of 29/30 cannot be
  reached by 10 runs, and reporting a percentage from them invites reading it as
  though it could.

A host that scores 100% on refresh latency and 0% on the canary is the exact
case this exists to catch, and the report prints both lines so it cannot be
mistaken for a pass.

## What this does not measure

Provider request counts and raw versus cached input tokens. Those need a
host-side trace the server cannot see; record them from the host and report them
next to the verdict. The roadmap asks for both, and a verdict published without
them is a partial answer that should say so.
