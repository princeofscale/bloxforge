# BloxForge — documentation

This directory is the user-facing handbook for BloxForge. The
[top-level README](../README.md) covers install and quick start; this directory
covers how the pieces fit together, host-specific setup, and the edge cases you
hit once you're building real games.

> **Start here if something breaks:** [troubleshooting.md](./troubleshooting.md).
> **Check engine limits first:** [known-limitations.md](./known-limitations.md).

## Guides

- [**Known limitations**](./known-limitations.md) — Roblox-engine constraints
  surfaced during dogfooding (`require()` cache after edits, audio loading in
  Edit, `PlaybackLoudness` in Edit). The canonical reference for "why didn't my
  edit apply" and "why won't this sound play."
- [**Troubleshooting**](./troubleshooting.md) — symptom → fix mapping for the
  common failures: plugin won't connect, bridge drops mid-session, version
  mismatch, timeouts on heavy Luau.
- [**Architecture**](./architecture.md) — Node MCP server ↔ Studio plugin bridge,
  request lifecycle, the edit/server/client peer model, and lazy tool loading.

## Host setup

BloxForge works with any MCP-compatible client. Host-specific notes:

- [Claude Code](./claude-code.md)
- [Codex CLI](./codex.md)
- [Cursor](./cursor.md)
- [Gemini CLI](./gemini.md)
- [Host conformance & capability matrix](./host-conformance.md) — which MCP
  features each host supports, and the lazy-loading / full-schema trade-off.

## Contributing

See the top-level [CONTRIBUTING.md](../CONTRIBUTING.md). When documenting a new
edge case or platform constraint, add it to
[known-limitations.md](./known-limitations.md) (the source of truth), not to a
scratch file.
