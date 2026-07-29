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
| **Integrate** | Rojo-aware project tools, imports/exports, asset workflows, and provenance records |
| **Protect** | Localhost binding, scoped capabilities, confirmation gates, dry runs, limits, and recovery |

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

## Recommended Rojo workflow

For file-backed projects, local files are the source of truth and Rojo owns the
continuous Studio sync:

```text
Codex / Claude → BloxForge MCP tools → local Luau files → rojo serve → Studio
                                             ↘ validate / format / test
```

1. Install stable Rojo through your pinned Rokit or Aftman toolchain.
2. Open the project locally and set `BLOXFORGE_PROJECT_ROOT` when BloxForge is
   launched outside that directory.
3. Use `rojo_detect_projects`, select an explicit project if more than one is
   found, then run `rojo_validate_project`.
4. Start loopback-only live sync with `rojo_serve_start`.
5. Let the agent read and edit local sources with the `rojo_*_source` tools.
6. Run targeted StyLua, Selene, or Luau checks for affected files.
7. Use the Studio bridge for inspection, playtests, runtime debugging, UI, and
   Instances outside the Rojo-managed roots.
8. Bring Studio changes back only through `rojo_syncback_plan`, review the
   conflicts, then call `rojo_syncback_apply` with confirmation.

This supports partially managed projects (only selected roots such as scripts
or packages) and fully managed project trees. BloxForge never treats unmanaged
Studio Instances as deletion candidates. Stable Rojo 7.7+ native `syncback` is
feature-detected; older stable versions retain the bounded plugin-based subset.
BloxForge reports installation guidance when Rojo is absent and never installs
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

Select one with `--profile <name>` or `BLOXFORGE_TOOL_PROFILE`.
Profiles control authorization where stated; `load_toolset` only expands
schema visibility and cannot grant a denied tool. Invalid names fail startup.

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
npm run test:plugin:smoke
npm run test:plugin:installer
npm run docs:check
npm run verify-package
```

## Documentation

- [Tool reference](docs/tools-reference.md)
- [Architecture](docs/architecture.md)
- [Known limitations](docs/known-limitations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Community

- Releases and project news: [official Telegram channel](https://telegram.me/ro_bloxforge)
- Bugs and feature requests: [GitHub Issues](https://github.com/princeofscale/bloxforge/issues)
- Security reports: follow the private process in [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © BloxForge contributors.
