# BloxForge agent guide

The primary operating guide for AI coding agents working **in this repository**.
Follow any more specific `AGENTS.md` found deeper in the tree as well.

If you are an agent *using* BloxForge to build a Roblox game, you want
[README.md](README.md) and [docs/tools-reference.md](docs/tools-reference.md)
instead.

## Project purpose

BloxForge is a local-first Model Context Protocol server plus a Roblox Studio
plugin. MCP clients inspect and modify Roblox experiences through a localhost
bridge. Preserve local-only operation, user control, and compatibility with
existing MCP clients.

## Repository map

| Path | Contents |
|---|---|
| `packages/core/` | Shared tool definitions, handlers, bridge, builders, Rojo/Rokit/Wally adapters, tests |
| `packages/robloxstudio-mcp/` | Main CLI, published as `@princeofscale/bloxforge` |
| `packages/robloxstudio-mcp-inspector/` | Read-focused CLI, published as `@princeofscale/bloxforge-inspector` |
| `studio-plugin/` | TypeScript compiled to the Studio Luau plugin via roblox-ts |
| `scripts/` | Build, docs, package, release, and integration utilities |
| `tests/` | Repository-level integration and regression coverage |
| `docs/` | Maintained user and contributor documentation |
| `evals/` | Evaluation fixtures and scenarios |

Never commit build output, tarballs, installed Studio plugins, credentials, or
local tool state.

## Invariants

Break one of these and the failure is silent, so they are listed before the
workflow rules.

1. **Effects are declared, never inferred.** `ToolDefinition.effects` is
   required. Do not reintroduce name-pattern inference: it once marked
   `export_rbxm` (Studio read + local file write) as reaching the network, and
   worse, it under-declared any new tool whose name did not match a pattern.
2. **Plans are immutable.** Anything that applies a previously previewed change
   takes the preview's `planHash` and refuses a stale one. A plan hash must
   cover every input the apply depends on — the operations, the remote
   identities, and the current content of every local file involved.
3. **Re-read before you write.** Every apply path re-checks the file against
   what the plan recorded, immediately before mutating it. Adding a new mutation
   path means adding that check; this has been the source of several data-loss
   bugs.
4. **A toolchain pin outranks `PATH`.** If `rokit.toml`/`aftman.toml` pins a
   tool, resolve the absolute shim. Never fall back to a bare command name —
   `execFile('rojo')` searches `PATH` even when the resolved metadata says
   `source: 'rokit'`.
5. **The bridge and plugin protocol are a compatibility boundary.** No silent
   request or response shape changes.
6. **Fail closed.** A damaged state file, an unparsable manifest, or an
   unsupported CLI flag stops the operation with an explanation. Never guess,
   and never silently downgrade (for example, dropping `--locked`).
7. **Secrets stay out** of source, logs, fixtures, changelogs, commits, and
   command output. Never print npm or GitHub tokens.
8. **Reconcile restores declared state and never invents new state.** A step
   that installs the exact version a manifest pins, or the packages a lock
   already resolved, is a repair. Choosing a version, resolving a new lock,
   editing the Rojo tree, or migrating Aftman is a decision: it comes back as a
   blocked step naming the `[automation]` flag that would permit it. When adding
   a step to `project-reconcile.ts`, decide which side of that line it is on
   before writing the implementation.

## Working rules

1. Inspect the branch, worktree, and relevant tests before editing. Preserve
   unrelated user changes.
2. Fix behaviour at the shared layer when both the full server and the inspector
   are affected.
3. Keep tool schemas, handlers, facade exports, output schemas, tests, and
   generated documentation synchronized.
4. Keep the plugin load order deterministic. Validate plugin changes against
   compiled Luau, not only TypeScript source. `sourceHash` in
   `ScriptHandlers.ts` must stay identical to `studioHash` in `sync-tools.ts`.
5. Prefer small, direct changes using existing utilities. Do not add
   abstractions or packages without a concrete need. `packages/core` has zero
   runtime dependencies — keep it that way, or say plainly why not.
6. Mark a deliberate shortcut with a `ponytail:` comment naming its ceiling and
   upgrade path.
7. Use Conventional Commits. Record every user-visible, behavioural,
   operational, security, compatibility, or release-related change under
   `CHANGELOG.md`'s `[Unreleased]` before committing.
8. Do not hand-edit generated tool-reference content; regenerate it.
9. Do not use destructive Git operations or rewrite shared history unless the
   user explicitly requests it.
10. After every push, inspect the GitHub Actions checks for that commit. Do not
    finish until every required check is green. On failure, read the logs, fix
    the root cause, validate locally, push, and repeat.

## Reviewing claims

Reviews of this repository — human or model-generated — have repeatedly been
wrong about third-party behaviour. Three examples that reached CI before being
caught:

- Rojo 7.7.0 was said to derive a project name for any `*.project.json`. It only
  does so for `default.project.json`; anything else crashes.
- `wally install --locked` was assumed to exist. It is absent from the released
  0.3.2.
- `rojo sourcemap` was assumed to emit every Instance. It emits only
  Script/LocalScript/ModuleScript without `--include-non-scripts`.

**Verify against the primary source** — the tool's tagged source or changelog,
not its documentation and not the review — before acting on a claim about
external behaviour. Say which claims you checked and which you could not.

Equally: a review finding that names a real defect is real even when the
suggested fix is wrong. Fix the defect; explain the deviation.

## Local validation

```sh
npm ci
npm --prefix studio-plugin ci
npm --prefix evals ci
```

Run what the change touches. Before a release, the full set:

```sh
npm run lint                  # 0 errors expected; ~43 pre-existing `any` warnings
npm run typecheck
npm test -w packages/core -- --runInBand
npm run build:all
npm run test:plugin:smoke
npm run test:plugin:installer
npm run test:plugin:runtime   # needs the pinned Lune runtime
npm run docs:check
npm run metadata:check
npm run tools:legacy-report -- --check
npm run test:fault-injection:10k
npm run verify-package
npm run release:check         # all of the above, in order
```

`release:check` runs everything CI runs, and that is the point of it. The 10,000-request
benchmark used to sit only in a separate `release:check:full`, so a green `release:check`
could still fail on CI's Node 20 job — which is exactly how a registration regression
reached CI. Anything CI gates on belongs here; do not split it back out.

Environment notes that have cost real debugging time:

- `docs:generate` reads `packages/core/dist`. Run
  `npm run build -w packages/core` first or `docs:check` compares against a
  stale build.
- `verify-package` crashes with `0xC0000409` when the repository path contains
  non-ASCII characters. That is environmental, not a regression — CI covers it
  on Linux, Windows and macOS.
- Set a temporary `MCP_PLUGINS_DIR` when testing plugin installation so the real
  Studio plugin directory is untouched.
- The real Rojo integration job runs on Linux only. The Rokit/Wally job runs on
  Linux per PR and on Windows and macOS nightly; push a commit whose message
  contains `[toolchain-matrix]` to run the cross-platform one on demand.

## Known traps in this codebase

- **Legacy tools are wrappers, not a second implementation.**
  `install_wally_packages`, `generate_rojo_sourcemap`, `build_rojo_project` and
  `resolve_instance_source_file` delegate to the canonical `rojo_*`/`wally_*`
  tools and return `deprecated: true`. Keep it that way: the moment one grows
  its own logic it becomes a path with weaker guarantees that an agent may well
  reach for first.
- `sync_pull`, `sync_status` and `sync_push` are deprecated in favour of
  `rojo_syncback_plan`/`_apply` and do not require a plan hash.
- The lint globs must stay quoted in `package.json`. Unquoted,
  `packages/*/src/**/*.ts` expands in the shell without globstar and silently
  lints nothing at the top level.
- Jest must run through `npm test`, not a bare `npx jest` — the latter picks up
  the wrong transform and fails on ordinary TypeScript.

## Documentation

Keep `README.md`, `docs/architecture.md`, `docs/known-limitations.md`,
`docs/tools-reference.md`, and `docs/troubleshooting.md` aligned with the
product. `docs/tools-reference.md` is generated. Add a new file only when the
information fits none of these.

## Release checklist

1. Set the same version in the root package, every published workspace, and
   `package-lock.json` (`npm install --package-lock-only`).
2. Move `[Unreleased]` entries into a dated release section and add its compare
   link at the bottom of the changelog.
3. Run `npm run release:check`; confirm the tree contains only intended changes.
4. Merge to the default branch and wait for its CI to be green.
5. Create and push `v<version>` **only then**, and publish the GitHub Release
   for that tag.
6. Publishing the release triggers both npm publishes and uploads the full and
   inspector plugin assets. Prereleases such as `-rc.1` use the npm `next`
   dist-tag and a GitHub prerelease.
7. Verify npm versions, dist-tags, release assets, and workflow status before
   calling the release done. The release workflow runs its own quality gate
   after the GitHub Release already exists — a failure there leaves a published
   release with no packages, so check it rather than assuming.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bloxforge** (24260 symbols, 63819 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user. For unified PDG impact, add `mode: "pdg"` with optional `line: <N>` — it returns statement-level `affectedStatements` over CDG + REACHING_DEF and inter-procedural symbols in `interproceduralByDepth`/`byDepth`; no-layer/degraded PDG results are UNKNOWN-risk notes (`--pdg` layer).
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).
- For control/data dependence, `pdg_query({mode: "controls", target: "fileOrSymbol"})` answers "under what condition does X run?" (CDG, incl. guard clauses) and `pdg_query({mode: "flows", target, variable})` traces "where does variable Y flow?" (REACHING_DEF). `--pdg` layer.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bloxforge/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bloxforge/clusters` | All functional areas |
| `gitnexus://repo/bloxforge/processes` | All execution flows |
| `gitnexus://repo/bloxforge/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
