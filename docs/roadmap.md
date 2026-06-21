# Roadmap

Current version: **v2.19.3** — contract plane with outputSchema, ToolRegistry, and AssetTools domain split.

## Near term

- **Interactive App UI** (MCP Apps) for asset-insertion review and bulk-change approval. Host-gated — ready when Cursor/Codex/ChatGPT ship full Apps support.
- **Hybrid semantic scene search** (embeddings + lexical) when scale proves it's needed. Currently the token bottleneck is schema loading (cut 77% by lazy loading), not search recall, so this stays parked until an eval shows a real lexical ceiling.
- **RuntimeTools domain split** — extract the playtest/multiplayer/simulation/input tools from the main facade into a dedicated class. The biggest remaining extraction.

## Medium term

- **Richer script diagnostics** — AI-suggested fixes for common Luau issues, deeper static analysis surfacing through the MCP.
- **Safer object diff preview** — visual tree diff before applying mutations.
- **More game templates** — fighting game, platformer, puzzle game templates alongside the existing obby/simulator/tycoon/round templates.
- **Documentation website** — dedicated docs site with search, interactive examples, and full API reference.

## Longer term

- **Example games** — complete games built entirely by AI agents using this MCP, published as open-source learning resources.
- **Eval benchmark suite** — standardized task set with success metrics for A/B testing agent+tool combinations.
- **Community build library** — user-contributed models in the build library format, with tooling to discover, preview, and import.
- **Open-source model publishing** — allow agents to publish builds and scripts to the community library directly.

## Not planned

- **MCP Apps scene browser** — a full "mini Studio in chat" isn't on the roadmap. The value is in asset review and mutation approval, not in replacing Studio's own Explorer view.
- **Heavy vector database** — semantic search will use lightweight local embeddings, not a separate vector store, until scene scale proves otherwise.
- **Full variable inspection** — live debugger variable watch is too host-dependent. Temporary instrumentation probes (inject → collect → remove) may ship instead.
