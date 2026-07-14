# BloxForge — documentation

This directory is the user-facing handbook for BloxForge. The
[top-level README](../README.md) covers installation and client setup.

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
- [**Tools reference**](./tools-reference.md) — generated schemas for every MCP tool.

## Contributing

See the top-level [CONTRIBUTING.md](../CONTRIBUTING.md). When documenting a new
edge case or platform constraint, add it to
[known-limitations.md](./known-limitations.md) (the source of truth), not to a
scratch file.
