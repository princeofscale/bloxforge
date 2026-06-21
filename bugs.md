# Bugs & Issues — MCP

Running bug log from dogfooding. Severity: 🔴 high · 🟡 medium · 🟢 low/cosmetic.
**Workflow: a bug gets an entry here; once it's fixed, delete the entry.** Fixed
history lives in [CHANGELOG.md](./CHANGELOG.md), not here.

## Open bugs

_None._ (B1–B8 were all fixed on 2026-06-19 and removed; see CHANGELOG.)

## Reference notes (not bugs — durable gotchas)

- **Audio ≠ models:** library audio assets (e.g. `rbxassetid://1837879082`) load and
  play in Edit (`IsLoaded=true`, valid `TimeLength`), unlike copy-locked toolbox
  models. Sound can be added via MCP reliably; the `LoadAsset` auth limitation is
  specific to InsertService model inserts.
