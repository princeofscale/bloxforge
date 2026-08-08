<p align="center">
  <img src="assets/banner.svg" width="100%" alt="BloxForge — build, inspect and test Roblox experiences with AI agents" />
</p>

<div align="center">
  <img src="assets/logo.svg" width="92" alt="BloxForge logo" />
  <h1>BloxForge</h1>
  <p><strong>Give AI coding agents a safe, local interface to Roblox Studio.</strong></p>
  <p>Inspect places, edit Luau, build worlds, run playtests, and debug live sessions from any MCP-compatible client.</p>

  [![CI](https://github.com/princeofscale/bloxforge/actions/workflows/ci.yml/badge.svg)](https://github.com/princeofscale/bloxforge/actions/workflows/ci.yml)
  [![npm](https://img.shields.io/npm/v/@princeofscale/bloxforge?label=npm&color=cb3837)](https://www.npmjs.com/package/@princeofscale/bloxforge)
  [![downloads](https://img.shields.io/npm/dm/@princeofscale/bloxforge?label=downloads)](https://www.npmjs.com/package/@princeofscale/bloxforge)
  [![Node](https://img.shields.io/badge/Node.js-20%20%7C%2022-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![license](https://img.shields.io/badge/license-MIT-6366f1)](LICENSE)

  [Get started](#quick-start) · [Explore tools](docs/tools-reference.md) · [Troubleshoot](docs/troubleshooting.md) · [Telegram](https://telegram.me/ro_bloxforge)
</div>

---

## Roblox Studio, controlled by your agent

BloxForge connects an MCP client to a lightweight Studio plugin over localhost:

```text
Claude Code / Codex / Cursor / Gemini
                  ↕ MCP
          BloxForge Node server
                  ↕ localhost
          Roblox Studio plugin
```

No BloxForge cloud account is required. Your place data and bridge traffic stay
on your machine.

| | What BloxForge provides |
|---|---|
| **Build** | Instances, UI, terrain, lighting, templates, reusable models, and generated scenes |
| **Code** | Read, search, patch, validate, and safely replace Luau source |
| **Test** | Playtests, simulated input, gameplay assertions, screenshots, and episode comparison |
| **Debug** | Runtime logs, transport diagnostics, memory data, breakpoints, and profiler captures |
| **Integrate** | Rojo, Rokit and Wally driven through their real CLIs; imports/exports, assets, provenance |
| **Protect** | Localhost binding, scoped capabilities, confirmation gates, immutable plans, dry runs, and rollback |

## Quick start

Requires Node.js 20 or newer.

### 1. Allow Studio HTTP requests

In Roblox Studio, open **Game Settings → Security** and enable
**Allow HTTP Requests**.

### 2. Install the Studio plugin

Run this once, and again whenever you update BloxForge:

```bash
npx -y @princeofscale/bloxforge@latest --install-plugin
```

Fully close and reopen Roblox Studio after installing or updating the plugin.

### 3. Connect your MCP client

<details open>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add bloxforge -- npx -y @princeofscale/bloxforge@latest
```

</details>

<details>
<summary><strong>Codex CLI</strong></summary>

```bash
codex mcp add bloxforge -- npx -y @princeofscale/bloxforge@latest
```

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

```bash
gemini mcp add bloxforge npx --trust -- -y @princeofscale/bloxforge@latest
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add this to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bloxforge": {
      "command": "npx",
      "args": ["-y", "@princeofscale/bloxforge@latest"]
    }
  }
}
```

</details>

Use `@next` instead of `@latest` to test release candidates.

> MCP clients normally start BloxForge before Roblox Studio. The message
> `Waiting for Studio plugin to connect...` means the server is healthy and
> idle. Open a Studio project whenever you are ready.

### 4. Verify everything

Start your MCP client, open a place in Studio, and run:

```bash
npx -y @princeofscale/bloxforge@latest verify
```

## File-backed projects: Rojo, Rokit, Wally

For file-backed projects, local files are the source of truth and Rojo owns the
continuous Studio sync. BloxForge drives the real CLIs — it never reimplements
their semantics:

```text
Codex / Claude → BloxForge MCP tools → local Luau files → rojo serve → Studio
                                             ↘ validate / format / test
```

| Tool family | Owns |
|---|---|
| **Rokit** | Which version of each executable runs |
| **Wally** | The package dependency graph |
| **Rojo** | The filesystem ↔ Studio mapping — the single source of truth |
| **BloxForge** | Orchestrating the three, and everything Studio-side |

### Getting a project running

`project_reconcile_plan` reads all of it at once — Rojo project, toolchain pins,
Wally lock, package mounts, sourcemap, `rojo serve` — and returns the ordered
steps that would make the project ready, each marked `automatic` or `blocked`.
`project_reconcile_apply` runs them under a single-writer lease, re-reading the
state after every step, and finishes with a strict verify.

It restores declared state and never invents new state: installing the exact
version `rokit.toml` pins and the packages `wally.lock` already resolved is a
repair; choosing a *new* version or resolving a new lock is a decision, and
those steps come back blocked with the `[automation]` flag that would permit
them. Defaults, overridable in `bloxforge.toml`:

```toml
[automation]
installPinnedTools    = true     # restore what the manifest already pins
installLockedPackages = true     # restore what the lock already resolved
generateSourcemap     = true
startRojo             = true
restartManagedRojo    = true

updateToolPins        = false    # each of these decides new state
updateWallyLock       = false
editRojoProject       = false
migrateAftmanToRokit  = false
```

Each run journals to `.bloxforge/reconcile/<runId>.json`, so passing the same
`runId` resumes an interrupted run instead of repeating finished steps.

The individual steps stay available, and doing it by hand is the same order:

1. Pin your tools in `rokit.toml`, then `rokit_status` → `rokit_install`.
   A project pinned to a version whose shim is not installed **fails with the
   install command**; it never quietly runs a different global Rojo.
2. `wally_validate_lock`, then `wally_install_apply`, then
   `wally_verify_rojo_mapping` to confirm the installed package directories are
   actually mounted by the project.
3. `rojo_detect_projects` → select an explicit project if more than one is
   found → `rojo_validate_project`.
4. `rojo_serve_start` for loopback-only live sync.
5. Read and edit local sources with the `rojo_*_source` tools; run targeted
   StyLua, Selene, or Luau checks on the files you touched.
6. Use the Studio bridge for inspection, playtests, runtime debugging, UI, and
   Instances outside the Rojo-managed roots.
7. Bring Studio changes back only through `rojo_syncback_plan` → review →
   `rojo_syncback_apply` with the `planHash` the preview returned.

Set `BLOXFORGE_PROJECT_ROOT` when BloxForge is launched outside the project
directory. Every file path resolves through that root.

### What is preview/confirm

Anything that writes files, installs packages, or mutates Studio in bulk is a
**plan/apply pair**. The plan is immutable: `rojo_syncback_apply` requires the
`planHash` from its preview and refuses a stale one, so an edit that lands
between review and apply is never silently carried through.

Wally installs default to `--locked` so a stale lockfile fails instead of being
rewritten. `--locked` is absent from the released Wally 0.3.2, so support is
probed: when the flag is missing the install still runs, but the lockfile is
backed up first and restored if the install moved it. The guarantee the flag
exists to provide is kept either way — it is never quietly downgraded.

This supports partially managed projects (only selected roots such as scripts or
packages) and fully managed project trees. BloxForge never treats unmanaged
Studio Instances as deletion candidates. Stable Rojo 7.7+ native `syncback` is
feature-detected; older stable versions retain the bounded plugin-based subset.
BloxForge reports installation guidance when a tool is absent and never installs
it silently.

## Try it

Start with a focused request:

> Inspect this place, summarize its architecture, identify runtime risks, and
> propose a safe implementation plan before changing anything.

Or let the agent execute an end-to-end workflow:

> Build a six-stage obby with checkpoints and a timer, playtest it, inspect the
> runtime logs, and fix any errors you find.

## Choose the right tool profile

Profiles keep tool discovery focused and reduce context use:

| Profile | Best for |
|---|---|
| `core` | Everyday inspection, scripts, and essential editing — the default discovery set |
| `builder` | UI, terrain, templates, assets, and scene construction; arbitrary Luau execution denied |
| `tester` | Playtests, runtime debugging, input simulation, and assertions |
| `full` | Every available BloxForge tool |
| `inspector` | Studio/local read authorization only; local writes, process execution, network access, and Studio mutation/execute tools are omitted |

Some pre-4.0 toolchain wrappers (`install_wally_packages`,
`generate_rojo_sourcemap`, `build_rojo_project`) remain discoverable for
compatibility. The unsafe `sync_pull`, `sync_status`, and `sync_push` wrappers
have been removed from MCP discovery; use the hashed `rojo_syncback_plan` →
`rojo_syncback_apply` flow. See
[Known limitations](docs/known-limitations.md#legacy-tools-bypass-the-newer-guarantees)
for the mapping.

Select one with `--profile <name>` or `BLOXFORGE_TOOL_PROFILE`.
Profiles control authorization where stated; `load_toolset` only changes schema
visibility and cannot grant a denied tool. Invalid names fail startup.

A loaded domain is re-advertised on every later request, so `load_toolset`
accepts `unload` to release one the session is finished with
(`{"unload":["runtime"]}` frees roughly 13.2k tokens per request; core is never
released). Both it and `tool_catalog_search` report each domain's `approxTokens`.

## Reliability and safety

BloxForge treats Studio as a recoverable local execution target:

- request acknowledgements, delivery leases, deduplication, and status lookup;
- safe retry rules that distinguish reads from mutations;
- explicit `outcome_unknown` handling after interrupted operations;
- bounded atomic recovery journals and payload-free p50/p95/p99 diagnostics;
- authenticated proxy forwarding with queryable primary request IDs;
- per-DataModel concurrency limits and backpressure;
- plugin session credentials and capability-scoped MCP clients;
- localhost-only bridge binding by default, with authenticated non-loopback opt-in;
- mutation confirmation, dry-run, backup, and rollback-oriented tools.

Authorization is by **declared effect**, not by a tool's name. Every tool states
its own `studio.*`, `local.files.*`, `local.process.execute`, `network.external`,
`assets.upload`, and `playtest.control` effects; the field is required, so a new
tool cannot inherit a wrong guess. The inspector profile permits only Studio and
local-file reads, and the builder profile denies arbitrary Luau execution.

See [Architecture](docs/architecture.md) and
[Security policy](SECURITY.md) for the full model.

## Optional Roblox Open Cloud access

Most features need no Roblox credentials. Creator Store access and asset
uploads can use an optional
[Open Cloud API key](https://create.roblox.com/dashboard/credentials?activeTab=ApiKeysTab)
with the required asset scopes:

```bash
export ROBLOX_OPEN_CLOUD_API_KEY="your-api-key"
```

Never commit the key or place it in shared MCP configuration.

## Develop locally

```bash
npm ci
npm run build:all
npm test
npm run lint
```

Plugin builds only write repository artifacts. Set `MCP_PLUGINS_DIR` to an
explicit temporary directory when testing installation; builds never infer or
modify your normal Studio plugin directory.

Useful release checks:

```bash
npm run test:plugin:smoke        # compiled Luau output
npm run test:plugin:installer    # both CLIs install atomically
npm run docs:check               # tools reference matches the definitions
npm run metadata:check           # package metadata matches the README
npm run verify-package           # packed tarball contents
npm run release:check            # everything above, in order
```

Integration jobs drive the real binaries and run in CI:

```bash
npm run test:rojo:integration       # pinned Rojo 7.7.0
npm run test:toolchain:integration  # pinned Rokit, plus Wally's actual --locked support
```

`docs:generate` reads `packages/core/dist`, so build core before checking docs.

## Documentation

- [Tool reference](docs/tools-reference.md)
- [Architecture](docs/architecture.md)
- [Known limitations](docs/known-limitations.md)
- [Agent guide (working on BloxForge)](CLAUDE.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Community

- Releases and project news: [official Telegram channel](https://telegram.me/ro_bloxforge)
- Bugs and feature requests: [GitHub Issues](https://github.com/princeofscale/bloxforge/issues)
- Security reports: follow the private process in [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © BloxForge contributors.
