# BloxForge roadmap

This roadmap tracks work that remains after the protocol v3 reliability changes listed in `CHANGELOG.md`. Completed work belongs in the changelog; this file intentionally contains only unfinished or partially verified milestones.


## P1 — Concurrency control and atomic mutations

- Extend fingerprint or version preconditions beyond `apply_mutation_plan` to property, script, object, terrain, and batch mutation tools.
- Detect Team Create conflicts and return a structured conflict instead of overwriting newer state.
- Add durable rollback receipts with a TTL and an `apply -> verify -> rollback` workflow.
- Add rich mutation diffs before apply. Arbitrary `execute_luau` remains outside atomic rollback guarantees.

## P1 — Observability and reproduction

- Split latency by queue, network, and Studio execution time and expose endpoint-level timeout and reconnect rates.
- Add redacted JSON diagnostic export, `doctor --deep`, and an automatic minimal reproduction bundle.
- Ensure diagnostics never contain bearer tokens, Luau source, request payloads, or user asset contents.

## P1 — Permissions and approval

- Audit every tool against the capability manifest and add contract tests for each profile.
- Add durable per-client identity where the transport permits it.
- Add interactive approval for arbitrary Luau execution, external asset operations, package installation, and publishing.

## P1 — CI and release coverage

- Run plugin compilation and runtime checks on Windows and macOS, beyond the current Node smoke jobs.
- Add real socket-close, proxy-primary restart, authentication, body-limit, journal-recovery, and packed-package installation tests.
- Validate Node 18, 20, and 22 release artifacts with the exact published tarballs.
- Make a real-Studio fault campaign a release-candidate gate when suitable CI infrastructure is available.

## P1 — External tool hardening

- Pin supported Rojo, StyLua, Selene, Luau analyzer, luau-lsp, Wally, and Lune versions and verify downloaded checksums.
- Add an explicit-confirmation installer, offline cache support, and Wally dependency and license auditing.
- Add framework-neutral Studio test adapters, starting with TestEZ and Jest-Roblox.
- Complete manifest-driven generation of schemas, dispatch tables, plugin typings, documentation, and contract tests.

## P2 — Large-scene performance

- Add chunked or binary transfer for RBXM files, screenshots, and other large responses.
- Add pagination to unbounded lists and limits for scan depth and Instance count.
- Add snapshot caching with invalidation and incremental world fingerprints.
- Make expensive scans cancellable and benchmark read, mutation, and heavy-operation latency separately.

## P2 — User workflow

- Add an approval UI for mutation diffs and destructive operations.
- Provide a first-class `apply -> verify -> rollback` command flow.
- Save a redacted reproduction bundle for bridge failures and generate a minimal reproduction where possible.

## Product invariants

- Keep the bridge local-first and bound to loopback by default.
- Never download tools, install packages, upload assets, execute arbitrary code, or publish without explicit user intent.
- Preserve compatibility with existing MCP clients and older plugin protocol versions where doing so does not weaken safety.
- Do not promise preemptive cancellation or atomic rollback for arbitrary Luau code.

## Recommended order

1. Expand optimistic concurrency and rollback beyond mutation plans.
2. Complete diagnostics, capability approvals, and the cross-platform release matrix.
3. Harden external tools, then optimize large scenes and polish the approval workflow.
