# Architecture

```
                    ┌─────────────────────────────────────┐
                    │        AI Coding Agent               │
                    │  (Claude Code / Codex / Cursor /     │
                    │   Gemini / any MCP client)           │
                    └──────────────┬──────────────────────┘
                                   │
                           MCP protocol (stdio)
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     Roblox Studio MCP Server         │
                    │     (Node.js / TypeScript)            │
                    │                                      │
                    │  ┌────────────────────────────────┐  │
                    │  │  Tool handlers (130+ tools)    │  │
                    │  │  · Scene read / mutation       │  │
                    │  │  · Script / Luau               │  │
                    │  │  · UI / Terrain / Environment  │  │
                    │  │  · Marketplace / Assets        │  │
                    │  │  · Playtest / Debug            │  │
                    │  │  · Safety layer                │  │
                    │  │  · Sync / Backup               │  │
                    │  └────────────────────────────────┘  │
                    │              │                        │
                    │  ┌────────────────────────────────┐  │
                    │  │  Tool pipeline                  │  │
                    │  │  (structuredContent,            │  │
                    │  │   errorEnvelope,                │  │
                    │  │   MCP resources)                │  │
                    │  └────────────────────────────────┘  │
                    └──────────────┬──────────────────────┘
                                   │
                      HTTP long-poll bridge (localhost)
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     Roblox Studio Plugin             │
                    │     (roblox-ts → Luau)               │
                    │                                      │
                    │  · Receives tool requests            │
                    │  · Operates the DataModel            │
                    │  · Returns results                   │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     Your Roblox Place                │
                    │                                      │
                    │  Workspace · ServerScriptService     │
                    │  ReplicatedStorage · StarterGui      │
                    │  Lighting · Terrain · Players        │
                    │  And everything in your place        │
                    └─────────────────────────────────────┘
```

## Key design decisions

### MCP over stdio

The standard MCP transport (stdio) means the server runs as a subprocess of your AI client. No network setup, no daemon management, no auth tokens for the transport layer.

### Local HTTP bridge

Inside the server, a lightweight HTTP long-poll bridge connects to the Studio plugin. This bridge runs on localhost only — no data leaves your machine. The plugin polls the bridge for requests, executes them against the DataModel, and posts results back.

### Plugin as thin executor

The Studio plugin is deliberately thin: it receives command + payload, runs it in the plugin context, and returns the result. All orchestration, safety checks, and response formatting happen in the Node server. This makes the plugin easy to update without restarting Studio (just re-run `--auto-install-plugin`).

### Safety by topology

The safety layer (dry-run, confirmation gating, backups, limits) is applied centrally at the tool dispatch level, not per-handler. Every tool automatically gets the same safety guarantees without individual opt-in.

### Dual-format output

Every tool response includes both a text block (for backward-compatible MCP clients) and `structuredContent` (for clients that support typed object responses, like Cursor and newer Claude Code versions).

## Packages

| Package | Description |
|---|---|
| `@princeofscale/robloxstudio-mcp` | Main MCP server with full read/write tool set |
| `@princeofscale/robloxstudio-mcp-inspector` | Read-only edition — no write tools |
| `@princeofscale/robloxstudio-mcp-core` | Shared core library (tools, builders, bridge) |
