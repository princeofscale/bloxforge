# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- An immutable plan for every toolchain mutation. `wally_install_plan`,
  `wally_update_plan`, `rokit_add_tool_plan` and `rokit_update_plan` now return
  `manifestHash`, `lockHash` and `planHash`, and the matching applies require
  `expectedPlanHash`. The pairs previously described a change against a manifest
  and lockfile another process could rewrite before the apply ran, and apply
  took only `confirm` — so two agents on one repository could review one plan
  and apply a different one. `locked: false` stays unpinned; it is the explicit
  "resolve me a new lockfile" path.
- A locked Wally install on a Wally that has no `--locked`. The flag is missing
  from the released 0.3.2, and refusing outright stopped every unattended flow
  on the Wally most people have. `wally_install_apply` now backs `wally.lock`
  up, runs the install, and restores the backup and fails if the lockfile moved,
  which is the guarantee the flag provides. Only the lockfile is rolled back.
- `report --project <dir>`, so the diagnostic report a user pastes into a bug
  carries the same Rojo/Rokit/Wally state `verify --project` already reported.

### Changed
- `rokit_status` no longer calls an unpinned or unparsable manifest healthy.
  `rojo = "rojo-rbx/rojo"` and `rojo = "nonsense"` both left `manifestVersion`
  and `matchesManifest` undefined, which matched no branch in the summary, so an
  installed shim made the whole manifest report `healthy: true, action: 'none'`
  — while `rokit_install` refuses those same specs unattended. Each tool now
  carries `validSpec` and `exactPin`, and a manifest problem reports
  `fix-manifest` with `installRequired: false`, because installing cannot fix it.
- `wally_verify_rojo_mapping` resolves `$path` against the directory holding the
  project file, as Rojo does, instead of the directory holding `wally.toml`.
  They coincide in a flat project; in a monorepo where
  `games/lobby/default.project.json` mounts `../../Packages`, the old base
  produced a bogus mapped/unmapped verdict.
- The `rojo serve` settle window watches `error` as well as `exit`. A failed
  spawn emits `error` and never `exit`, so waiting on `exit` alone timed out and
  reported "the child survived" for a process that never ran — and a foreign
  Rojo answering on the port would then have been adopted. Readiness also
  re-checks the process state after the wait rather than overwriting it.
- One CLI flag parser, and it treats a flag-shaped value as a missing value.
  `--port --strict` set the port to `"--strict"`, and `--session-token --debug`
  stored `"--debug"` as a credential. A second copy of the same helper inside
  the server path had the same bug for `--open-cloud-key`, `--creator-id`,
  `--creator-group-id`, `--pollinations-key` and `--profile`. `--port` must now
  be an integer in 1..65535 and `--profile` one of the five known profiles;
  anything else is reported and ignored rather than passed through.
- Quality tools spawn one process per call instead of two. `run()` probed the
  binary with `--version` and then ran the real command, which doubled the
  process count for every call and left a window for the tool to disappear in
  between. `ENOENT` from the real invocation is the same answer.
- `scripts/publish.mjs` distinguishes "not published" from "the registry did not
  answer". Every `npm view` failure — a timeout, a 429, an auth error, an outage
  — used to read as absent, so a rerun during an outage tried to republish an
  immutable version. Only a real 404 counts as absent now; a transient failure
  is retried and then aborts rather than publishing blind.
- Split the release workflow's publish job from asset upload. The publish job
  runs three `npm ci` runs, a build and a publish — a large amount of
  third-party code — and now does so with `contents: read` and without
  persisted credentials. A separate job with `contents: write` downloads the
  built plugins as an artifact and runs only `gh release upload`.

### Added (toolchain resolver)
- One shared project-aware toolchain resolver for every tool a
  `rokit.toml`/`aftman.toml` pins — Rojo, Wally, Selene, StyLua, Lune,
  luau-lsp — instead of a resolver private to Rojo. Selene and StyLua were
  probed with a bare name, so a project that pins them ran whatever version
  happened to be on `PATH`, or reported them missing while a pinned shim sat
  installed. Availability is now per project: a tool the manifest declares never
  falls back to `PATH`, and a pinned-but-uninstalled tool reports the install
  step rather than reading as absent.
- `verify --project <dir> [--strict] [--json]`, which checks Rojo project
  discovery, toolchain pins, the Rojo binary, the Wally lockfile, and the Wally
  package mapping for a real project directory and emits
  `{ready, strict, checks, nextAction}` for an agent to branch on.
- A nightly cross-platform toolchain job (windows-latest, macos-latest) that
  installs Rokit from checksum-pinned release assets and runs the Rokit/Wally
  integration script. It also runs on demand for a commit whose message
  contains `[toolchain-matrix]`. The per-platform checksums were read from the
  GitHub release API, not copied from the Linux pin.

### Changed
- `rokit_status` now reports the running version of each shim against the
  manifest pin, so a stale install is `install`-actionable instead of healthy.
  A manifest whose tool name is not a safe shim name is reported as
  `fix-manifest` and blocks the install path entirely.
- `rokit_install` passes `--no-trust-check` only when every pin in the manifest
  is an exact `x.y.z`, and returns the exact sources it trusted. A loose
  requirement is refused rather than resolved to whatever the manifest happens
  to match today.
- `wally_validate_lock` compares versions, not just names. The lockfile graph is
  keyed `name@version`, dependency requirements are checked against the locked
  version, and the result separates `mismatched`, `unverifiable`, and
  `unresolved` — a requirement shape it cannot evaluate is reported as
  unverifiable rather than silently passing.
- A managed `rojo serve` is ready when `/api/rojo` returns a Rojo server info
  document *and* the managed child then outlives a short settle window — not
  when the port merely accepts a connection. `child.exitCode === null` alone
  proved nothing: a foreign Rojo can bind between the free-port check and the
  child's own bind, and while the child is on its way to an `EADDRINUSE` exit
  its exit code is still null, so the stranger's response was accepted as
  readiness. Either case now reports "Another Rojo already answers on
  host:port"; `sessionId` and `projectName` are reported on success. This is a
  timing argument rather than a kernel-level ownership proof — the remaining
  window is written down in `docs/known-limitations.md`.
- Project discovery no longer descends into `Packages`, `ServerPackages`, or
  `DevPackages`, so a Wally dependency's own `*.project.json` cannot be offered
  as the project to sync.
- `install_wally_packages`, `generate_rojo_sourcemap`, `build_rojo_project`, and
  `resolve_instance_source_file` are now thin wrappers over the canonical
  `wally_*`/`rojo_*` implementations and return `deprecated: true` with a
  pointer, so they inherit the toolchain resolution and confirmation contract
  they used to bypass. They are off the core tool list; the canonical detection,
  status, and validation tools took their place.
- `doctor` requires Node 20, matching `engines.node` on every published package.
  The check still said "Node 18+" long after the floor moved.
- `scripts/publish.mjs` publishes per package, skips a version already on the
  registry, and verifies presence afterwards, so a rerun after a partial failure
  finishes the remaining package instead of dying on the published one.
- Split the release workflow into a read-only `gate` job and a `publish` job, so
  the gate runs without `contents: write` or persisted credentials.

### Fixed
- Stopped a pinned-but-uninstalled toolchain from running a global Rojo at
  spawn time. The 4.0.1 fix corrected which command was *reported* but left the
  executable as the bare name `rojo`, and `execFile` resolves a bare name
  through `PATH` — so a project pinned to 7.7.0 with no shim still ran whatever
  global Rojo existed while reporting `source: 'rokit'`. The resolved command is
  now the absolute shim path even when missing, so the spawn fails with the
  install instruction. The old test asserted only on metadata; it now runs the
  binary with a working global Rojo on `PATH`.
- Classified `rokit_*` and `wally_*` into the `sync` tool domain. Without a
  prefix rule they fell through to the `scene` default, so loading the `sync`
  toolset produced the Rojo tools without the toolchain tools they depend on.
- Stopped `verify` reporting `Wally lockfile: ok` for an unparsable `wally.toml`
  or `wally.lock`. One `catch` covered the whole Wally block to allow for a
  project that does not use Wally, so every other failure — a parse error, an
  unreadable manifest, an ambiguous Rojo project raised inside the mapping
  check — landed there as a pass, and a throw after the lockfile check had
  already been recorded emitted a *second* check under the same name. Only the
  "no wally.toml anywhere above" error is a skip now; the mapping check has its
  own `catch`.
- Made `verify --json` take `nextAction.check` and `nextAction.fix` from one
  check. They were four independent lookups, so a failure with no `actionable`
  was reported by name alongside an unrelated warning's fix.
- Stopped the shared resolver falling through to a second toolchain when the
  first manifest that pins a tool has no installed shim — that ran an
  aftman-pinned version against a rokit-pinned project and disagreed with
  `RokitTools.detect`, which stops at the first manifest it finds. The resolver
  also no longer throws when the project root disappears between its `existsSync`
  and `realpathSync`, which broke its documented never-throws contract and
  escaped `quality-tools` as an unhandled error rather than `available: false`.
- Dropped the single-candidate fallback that resolved a Wally lock edge whose
  only candidate did not satisfy the requirement, so `unresolved` stayed empty
  and `validateLock` could pass a lock whose transitive edge points at a
  rejected version. A locked prerelease is now `unverifiable` rather than
  compared with its suffix stripped (Cargo excludes prereleases from a plain
  requirement), and a bare `~1` spans the whole major as Cargo defines it.
  `validateLock.missing` uses the same `alias = spec` shape in both branches.
- Fixed `verify --project` swallowing the following flag as its value, so
  `verify --project --strict` checked a directory named `--strict`.
- Removed `cache: npm` from the release workflow. It is release-triggered, and
  the lockfile-keyed npm cache is shared with less-trusted workflows, so a run
  holding only a default `GITHUB_TOKEN` could seed an entry that `npm ci`
  restores and executes here.
- Brought `packages/*/src/**/*.mjs` test fixtures into the ESLint config and the
  `lint:packages` glob. They matched no config block, so Node globals read as
  undefined and the files could only be linted by hand.

### Documentation
- Rewrote the README's Rojo section to cover the whole toolchain, including who
  owns what, the preview/confirm contract, and the plan-hash requirement.
- Rewrote `AGENTS.md` as an operating guide: the invariants that fail silently
  when broken, how to verify a review claim against primary sources, the real
  validation gates, and the traps in this codebase.
- Rewrote the toolchain, managed-`rojo serve`, and legacy-tool sections of
  `docs/known-limitations.md`, `docs/troubleshooting.md`, and
  `docs/architecture.md` for the behaviour above, including what a pinned tool
  reports when its shim is missing, what `wally_validate_lock` calls
  unverifiable, and what "Another Rojo already answers on…" means.
- Recorded the two items from the review that were deliberately **not** built:
  a supervised `rojo serve` with backoff, a process lease, and adoption after a
  restart; and a `project_reconcile` orchestration flow driven by an
  `[automation]` policy block. Both are real gaps, not oversights.

## [4.0.1] - 2026-07-31

### Changed
- Made `ToolDefinition.effects` required and deleted the name-pattern
  inference behind it. `/asset|marketplace|…|export_rbxm/` decided whether a
  tool reached the network, so `export_rbxm` — which asks Studio for bytes and
  writes them to disk — was marked `network.external` and never
  `local.files.write`. A pattern also fails in the dangerous direction: a new
  tool that does reach the network inherits no `network.external` unless its
  name happens to match, and a capability policy would wave it through. All 209
  tools now declare their own effects and an omission is a compile error.
- Excluded the paths a Rojo project declares through `globIgnorePaths` and
  `syncbackRules.ignorePaths` from the native syncback recovery snapshot, and
  included both lists in the plan hash. Rojo evaluates them per path relative to
  the project directory and will not write to a match, so they cannot need
  restoring. The snapshot is deliberately still not scoped to the dry run's
  reported paths: `--list` is human-readable output, not a machine contract, and
  a path a parse missed would be unrecoverable after a partial failure.
- Upgraded ESLint and `@eslint/js` to 10 together. Dependabot offered
  `@eslint/js` alone, which would have mixed majors of one toolchain;
  typescript-eslint 8.65 already declares ESLint 10 support, so it needed no
  bump. ESLint 10's `recommended` set adds `preserve-caught-error` and
  `no-useless-assignment`, and both were fixed rather than switched off: 17
  rethrows now carry `{ cause }` so the original failure survives, and 8 dead
  initializers are gone.

### Fixed
- Corrected three tool effect sets the name heuristic had wrong:
  `export_rbxm` is `studio.read` plus `local.files.write`,
  `get_asset_provenance` reads an in-memory map and has no effects, and
  `import_rbxm` declares the local read it always performs alongside the
  network access only its `url` form uses.

## [4.0.0] - 2026-07-31

### Added
- Added `rokit_*` and `wally_*` MCP tools backed by a real TOML reader:
  toolchain detection, manifest reads, shim-vs-manifest-vs-running version
  status, and confirmed install/add/update, plus Wally manifest, lockfile,
  dependency-graph, lock validation, search, locked install, update, and a
  check that installed package directories are mapped by the Rojo project.
- Added `.project.jsonc`, `.meta.jsonc`, `.model.jsonc`, `.jsonc`, `.luau`,
  `.server.luau`, `.client.luau`, `.plugin.lua`, `.plugin.luau`, `.yml`, and
  `.yaml` to Rojo source classification and project discovery, matching Rojo
  7.7's own sync rules.
- Added `instancePathSegments` to Rojo instance/source resolution so an Instance
  whose name contains a dot is no longer ambiguous.
- Added `includeNonScripts` to `rojo_generate_sourcemap`. Rojo emits only
  Script/LocalScript/ModuleScript by default, so folders, models, and other
  non-script Instances could not be resolved through a generated sourcemap.
- Added a `resetBaseline` option that quarantines an unusable
  `.bloxforge/rojo-state.json` and rebuilds the sync baseline explicitly.
- Added a Rokit + Wally CI job that installs a checksum-pinned Rokit, resolves
  tools through its shims, and asserts the installed Wally's actual `--locked`
  behaviour.

- Added a CI contract that cross-checks canonical definitions, registry entries,
  legacy handlers, schemas, domains, capabilities, and duplicate tool names.
- Added a paginated, inspector-compatible plugin endpoint for bounded managed
  script metadata/source reads with continuation tokens, byte limits, and hashes.
- Added a local-first Rojo adapter with arbitrary project discovery, JSONC
  parsing, official file mappings, sourcemap resolution, pinned-version command
  execution, managed loopback `rojo serve`, safe source editing, and guarded
  native `syncback` support.
- Added registry-only `rojo_*` MCP tools for discovery, validation, serve
  lifecycle, builds, sourcemaps, source mapping/editing, and explicit syncback.
- Added pinned stable Rojo integration and legacy-dispatch regression gates;
  `release:check:full` also runs the 10,000-request benchmark.

### Changed
- Resolved the Rojo command per canonical project root instead of once per
  process, keyed by the nearest `rokit.toml`/`aftman.toml` and its mtime, so a
  toolchain change or install is picked up without restarting the server.
- Made the Rojo project `name` field optional, deriving it the way Rojo has
  since 7.4.1 (`default.project.json` takes the parent directory name). Rojo
  7.7.0 itself only implements this for `default.project.json`; documented that
  a nameless non-default project file crashes the CLI.
- Probed whether the installed Wally supports `wally install --locked` instead
  of assuming it. The flag is absent from the released 0.3.2, and silently
  dropping it would rewrite the lockfile it exists to protect; a locked install
  is now refused with an explanation.
- Required the `planHash` returned by `rojo_syncback_plan` on every
  `rojo_syncback_apply`, for the bounded Studio adapter as well as native
  syncback, and widened the hash to cover the reported operations, each mapped
  script's Studio identity, and the current hash of every local file.
- Replaced the whole-file diff returned by Rojo source edits with a bounded
  single-hunk unified diff, and bounded `rojo_read_source` by file size.
- Strengthened Studio content identity from a single 31-bit rolling hash to two
  independent rolling hashes plus the byte length; the sync state schema is
  now version 2 and an older baseline requires `resetBaseline`.
- Regenerated the tools reference for the new toolchain tools.

- Changed quick-start configuration to install the Studio plugin explicitly once and launch the MCP stdio server without filesystem installation work on every Codex/Claude session.
- Updated the MCP SDK and patched transitive runtime dependencies; `npm audit --omit=dev` now reports zero production vulnerabilities.
- Redesigned the README around a clearer product pitch, client-specific setup, safety model, tool profiles, and contributor workflow.
- Reduced published CLI packages to the matching compiled Studio plugin plus required runtime assets; source trees, runtime includes, and the opposite plugin variant are no longer bundled.
- Upgraded to ESLint 9 with flat configuration and Jest 30 while retaining the supported Node 20/22 matrix.
- Assigned distinct red, yellow, and green toolbar icons to both full and inspector plugin connection states.
- Expanded lint and `tsc --noEmit` gates across both CLIs, core, scripts, tests,
  evals, and Studio plugin source; added package metadata consistency and
  cross-platform installer/package smoke checks.
- Declared the dependency-compatible Node.js 20+ floor in every maintained
  package, removed the false Node 18 CI claim, and removed direct `cors` and
  `node-fetch` dependencies after source and packed-bundle verification.
- Extended the 10,000-request benchmark to assert bounded heap, status history,
  journal size, latency samples, counters, request IDs, timers, and pending work.
- Replaced binary read/write authorization decisions with explicit Studio,
  local-file, local-process, network, asset-upload, and playtest effects while
  retaining the legacy category metadata for protocol compatibility.
- Prepared package metadata for 4.0.0 because the published 3.0.0 release
  supported Node.js 18 and the new Node.js 20+ runtime floor is a breaking change.

### Fixed
- Stopped a Rokit- or Aftman-pinned project from silently running an unrelated
  global Rojo. The resolver probed `PATH` before honouring the manifest, so a
  project pinned to 7.7.0 with no installed shim ran whatever version happened
  to be on `PATH` — the exact drift the pin exists to prevent.
- Fixed sourcemap instance resolution prefixing every path with the project
  name. Rojo names the sourcemap root after the project, not `game`, so
  `game.ReplicatedStorage.Shared` never matched in a project named anything
  else; user-facing paths now start at the root's children.
- Treated only a leading `game` segment as the DataModel in dotted instance
  paths, matching the segment form. An Instance legitimately named `game` was
  dropped from the middle of a path and resolved to the wrong source.
- Made `sync_pull` re-read a rename source before moving it. The write path
  verified each file against the plan and the rename path did not, so a source
  the plan never read was moved into a managed path and recorded as the
  confirmed baseline.
- Made `sync_push` re-read each file immediately before sending it. It pushed
  the plan's snapshot, so an edit landing after planning overwrote Studio with
  content the caller never reviewed and was then recorded as agreed.
- Re-verified the content hash immediately before `rojo_patch_source` writes and
  `rojo_delete_source` unlinks, closing most of the window between the
  optimistic-locking check and the mutation.
- Reported an unusable `root` from `rojo_get_version` instead of swallowing it
  and answering for whatever Rojo the server's own working directory resolves.
- Bounded the Rojo command runner's toolchain-manifest search by
  `BLOXFORGE_PROJECT_ROOT`; it walked to the filesystem root and could pick up a
  `rokit.toml` from outside the workspace.
- Keyed the Rojo resolution cache on the shim as well as the manifest, so an
  external `rokit install` no longer needs a server restart to take effect.
- Detected `rojo serve` readiness by connecting to its port instead of matching
  its stdout banner, which is not API and has changed between releases. A
  healthy server whose wording drifted was killed on timeout; failures now
  include the tail of the process log.
- Recognised `.project.jsonc` in the legacy quality-tool project detection, and
  stopped an unreadable project directory from failing detection outright.
- Compared Rokit manifest pins to the running version component-wise. Substring
  matching reported 17.7.0 as satisfying a 7.7.0 pin.
- Compared Wally package directories case-sensitively on Linux, where
  `Packages` and `packages` are different directories and folding case reported
  a mount Rojo would fail to resolve as mapped.
- Fixed `rojo_generate_sourcemap` failing on every run after the first: the new
  output-overwrite guard classified the existing `sourcemap.json` as a Rojo
  value source and refused to replace it.
- Stopped the TOML reader from reaching `Object.prototype`. Manifest data
  controls every key, so `__proto__` could pollute and `toString`/`constructor`
  were rejected as duplicates of inherited members.
- Fixed `wally_verify_rojo_mapping` matching package directories as substrings
  of the stringified project tree, so a project mounting only `ServerPackages`
  reported `Packages` as mapped; it now compares resolved `$path` values.
- Fixed `sync_push` recording a successful baseline for scripts the plugin
  rejected. The plugin returns an `{ error }` envelope rather than throwing, so
  a failed push looked in-sync afterwards and the local edit was lost.
- Fixed managed-script pages reporting a changed script as `tooLarge` when it
  merely exhausted the remaining page budget; the page now ends so the script
  starts the next one with a full budget instead of never being fetched.
- Bounded the Studio managed-script pagination loop by page count and repeated
  continuation tokens instead of trusting the peer to terminate it.
- Treated only a leading `game` segment as the DataModel prefix so an Instance
  legitimately named `game` is no longer dropped from its path.
- Logged only the message when a Streamable HTTP request fails, so a thrown
  object cannot serialize request or credential details into the log.
- Removed the non-existent `rokit run rojo --` fallback. Rokit has no `run`
  subcommand, so a Rokit-only project either used an unrelated global Rojo or
  failed; BloxForge now uses the toolchain's installed shim and, when a manifest
  pins Rojo without one, reports the install step instead of falling back.
- Fixed native syncback rollback skipping files it could not classify. The
  recovery snapshot now covers every regular file under the project root and
  removes directories syncback created, so a partial `.luau`, `.jsonc`, or YAML
  syncback failure is fully restored.
- Refused to apply a native syncback whose dry run failed; a failed preview
  previously still produced a plan hash that `confirm=true` would accept.
- Stopped encoding Studio Instance names that no portable file name can
  represent. Rojo does not decode such names, so the next `rojo serve` renamed
  the Instance; unrepresentable names are now reported as `unsupported` and no
  file is written.
- Made the sync state file fail closed. A corrupt, foreign, or wrong-schema
  `.bloxforge/rojo-state.json` no longer reads as "never synced" (which made
  every local file look like a Studio addition) and blocks the operation until
  the baseline is explicitly reset.
- Made the sync state write part of the same transaction as the file changes it
  describes; a failed state write now rolls the filesystem back instead of
  leaving changed files with a stale baseline.
- Required a unique content match before inferring a rename, and reported
  otherwise-ambiguous candidates, so two identical scripts no longer cause an
  arbitrary file to be moved.
- Skipped baseline-only entries during `deleteMissing` instead of failing on an
  already-absent path, and re-verified each file's hash immediately before
  writing or deleting it.
- Enforced `expectedAbsent` with an exclusive create instead of an
  `existsSync` check followed by a rename, closing the overwrite race.
- Validated Rojo output paths: builds must target `.rbxl`/`.rbxlx`/`.rbxm`/
  `.rbxmx`, sourcemaps must target `.json`, and neither may overwrite a project
  file or an existing Rojo source.
- Bounded sourcemap size and nesting depth, and bounded Rojo project discovery
  by count and directory depth.
- Fixed `set_script_source` rejecting an empty string as a missing value, so
  clearing a script's source is possible again.
- Removed the destroy-and-recreate fallback from `set_script_source`. It
  preserved only `Name` and `Enabled`, silently dropping attributes, tags,
  children, and every reference to the script; the operation now fails loudly
  and leaves the script untouched.
- Ported the upstream cookie-auth image upload fix: uploads now use the
  `apis.roblox.com` user-auth assets API with operation polling instead of the
  legacy `data.roblox.com` decal endpoint, which no longer accepts them.
- Ported upstream structured runtime log context: `LogService.MessageOut`'s
  third argument is preserved as optional `data` on each runtime log entry.
- Fixed the lint gate silently skipping every top-level `packages/*/src/*.ts`
  file — including `http-server.ts`, `bridge-service.ts`, and `server.ts` —
  because the unquoted glob was expanded by the shell instead of ESLint, and
  fixed the errors that were hiding behind it.
- Fixed two integration test scripts throwing from a `finally` block, which
  replaced the real test failure with the cleanup failure.
- Fixed `listenWithRetry` using an async Promise executor, where a rejection
  raised before `reject` ran became an unhandled rejection.
- Logged the underlying error when a Streamable HTTP request fails instead of
  discarding it behind a generic 500.
- Replaced the Wally dependency graph's line-regexp lockfile reader, which
  returned TOML field names such as `name`, `dependencies`, and `registry`
  instead of packages, with real `[[package]]` parsing.
- Preserved the existing file mode when the sync adapter rewrites a file
  instead of forcing 0600 onto it.

- Fixed Studio reconnects after an MCP process restart by detecting rejected stale session tokens, re-running the `/ready` bootstrap, and rotating server-side plugin credentials.
- Fixed authenticated plugin disconnects so normal Studio/plugin shutdown removes the registration immediately instead of leaving a stale duplicate for up to 90 seconds.
- Fixed connection indicators retaining stale success state during retries, and made duplicate registrations retry after the previous session disappears.
- Fixed bridge-journal write failures turning otherwise successful live operations into HTTP 500 responses on read-only or unavailable home directories.
- Fixed production WebSocket authentication: the server now accepts the bearer header sent by Studio instead of rejecting every stream upgrade and silently falling back to polling.
- Fixed reconnect receipt reconciliation being rejected because the plugin omitted its session bearer token.
- Fixed invalid bridge ports and non-`EADDRINUSE` bind errors being misreported as proxy mode, and stopped repeating unchanged connection-state logs every five seconds.
- Fixed contracted tools retaining the pre-proxy bridge after a second MCP client connected; registry handlers now use call-time dependencies and remain available after proxy-to-primary promotion.
- Fixed Streamable HTTP lazy discovery hiding every non-contracted tool, and restored the real input schemas for asset preflight and recipe tools.
- Centralized bridge request-state transitions so queued work times out normally,
  only delivered/started mutations become `outcome_unknown`, late/duplicate
  callbacks are inert, and retry/timeout/cancellation/latency counters update once.
- Made the plugin protocol manifest exhaustive and fail closed for unknown
  endpoints, replacing duplicated read/mutation and heavy-timeout heuristics.
- Bounded request-journal status and receipt retention in memory and on disk,
  preserved active work during compaction, and kept atomic mode-0600 writes.
- Authenticated every proxy-to-primary control request, preserved a queryable
  primary request ID across uncertain mutation timeouts, and bounded/stopped
  proxy instance refreshes with visible stale-cache state.
- Fixed same-session WebSocket replacement losing leased work, ignored stale
  socket frames and callbacks, bounded payload/backpressure, and cleaned up
  stream notifiers, heartbeats, and sockets during shutdown.
- Corrected `run_gameplay_assertions` from read to execute-capable authorization
  and denied assertion-bearing runtime tools in the builder and inspector profiles.
- Isolated package verification from the user's global npm cache so stale
  permissions or cache ownership cannot break packed-artifact validation.
- Avoided request-journal compaction work when persistence is disabled while
  retaining bounded in-memory terminal status and latency histories.
- Cached invariant Streamable HTTP tool-definition indexes instead of rebuilding
  and linearly scanning the catalog on every tool-list or tool-call request.
- Fixed CI package dry-runs building without required plugin artifacts, Windows
  interrupted-download cleanup racing an open file handle, and POSIX-only
  journal permission assertions running on Windows; package verification now
  invokes npm portably without executing Windows command shims directly.
- Fixed project detection and Rojo build/sourcemap selection for arbitrary
  `*.project.json` names, with structured ambiguity instead of guessing.
- Serialized concurrent managed Rojo starts, waited for timed-out children to
  exit, reused bounded plugin pagination snapshots, and skipped retransmitting
  unchanged Studio source through baseline hashes.

### Security
- Refused unauthenticated non-loopback bridge bindings, authenticated internal
  server-control and diagnostic routes when a server token is configured,
  rejected non-JSON/browser-origin control requests, and removed operation
  payloads from public localhost diagnostics.
- Enforced inspector read-only and builder no-arbitrary-Luau profile policies
  at dispatch (not only schema discovery), and rejected invalid profile names.
- Warned when compatibility CLI flags carry secrets and documented the
  environment-variable migration path.
- Confined every QualityTools input/output path through canonical project-root
  checks, rejected option-shaped and escaping symlink paths, guaranteed temporary
  cleanup, and returned bounded structured missing-tool/timeout/output-limit errors.
- Made Studio plugin installation atomic and validated release type, variant,
  version, redirect policy, timeout, and download size before replacing a
  working plugin or removing the opposite variant.
- Stopped plugin builds from modifying a user's Studio plugin directory unless
  `MCP_PLUGINS_DIR` is explicitly set.
- Confined legacy sync and all Rojo paths to the canonical project root,
  rejected symlink/option/traversal escapes, encoded unsafe Instance names,
  required preview/confirmation, used backups and atomic writes, and replaced
  plaintext source manifests with bounded hash-only local state.

### Deprecated
- Deprecated `sync_pull`, `sync_status`, and `sync_push` in favor of the
  local-files-first Rojo workflow and explicit `rojo_syncback_plan/apply`.

### Removed
- Removed the standalone roadmap; completed work remains in the changelog and future work is tracked through GitHub issues.

## [3.0.0] - 2026-07-14

### Added
- Added a maintained `roadmap.md` that separates completed reliability work from the remaining recovery, cancellation, concurrency, observability, security, CI, tooling, and large-scene milestones.
- Added protocol v3 stale-response fencing with a per-process server epoch, plugin session binding, monotonic delivery attempts, and random lease tokens for every acknowledgement/result.
- Added a mode-0600 persistent bridge journal. Queued commands recover after restart, while previously delivered/started commands recover as `outcome_unknown` and require reconciliation instead of unsafe replay.
- Added optimistic-lock expectations and best-effort atomic rollback to `apply_mutation_plan`, plus cooperative cancellation checkpoints for async execution.
- Added `get_transport_diagnostics` with payload-free queue, retry, BUSY, cancellation, unknown-outcome, completion, and latency percentile metrics.
- Added Windows and macOS Node 20 smoke jobs alongside the existing Linux Node 18/20/22 matrix.
- Added opt-in capability enforcement for stdio and token-identified HTTP clients (`read.scene`, `write.properties`, `write.instances`, `execute.luau`, `assets.external`, and `playtest.control`).
- Added request delivery leases, acknowledgement/result state tracking, bounded completed-request deduplication, request status lookup, and safe pre-start cancellation for bridge commands.
- Added a shared transport policy manifest, per-DataModel read/mutation concurrency limits, bounded pending queues, and structured `BUSY` responses.
- Added an explicit `test:fault-injection` CI gate covering delivery leases, disconnect recovery, duplicate responses, and timeout outcomes.
- Added a deterministic 10,000-run effectively-once transport benchmark to CI; it verifies stable request IDs on redelivery, duplicate-result tolerance, completed status retention, and zero leaked pending requests.
- Added optional project-quality tools for Rojo-style project detection/build/sourcemap generation, Luau/Selene/StyLua/luau-lsp validation, StyLua preview, sourcemap resolution, framework-neutral Lune test scripts, Wally dependency inspection/install, and a structured quality gate.
- Added per-plugin session bearer tokens and bumped the bridge protocol to v2; plugin transport endpoints now authenticate after `/ready` bootstrap.
- Added the official BloxForge Telegram channel to a redesigned README with new SVG banner and logo artwork.
- **Package Verification CI**: Added `scripts/verify-package.mjs` to install and smoke-test the packed core, CLI, and inspector workspaces in an isolated temporary project.
- **Generated Documentation Gate**: Added `docs:check` to CI and release validation so stale generated tool documentation cannot ship.

### Fixed
- Fixed unacknowledged mutation leases being blocked by their own expired in-flight slot; disconnected started work now reports `outcome_unknown` instead of a retryable disconnect error. Client-broker polling now sends its session bearer token.
- Fixed proxy-mode heavy endpoint timeouts to use the same timeout floors as the primary bridge.
- Fixed timed-out delivered commands to report `outcome_unknown` with a request ID instead of silently inviting unsafe mutation retries.
- Ported the upstream 2.22.2 malformed-log fix: invalid UTF-8 bytes from Studio Output are escaped before JSON serialization, oversized escaped messages are dropped without evicting buffered entries, and plugin response serialization or delivery failures are now observable.
- **Plugin Compilation Issue**: Fixed `compile:plugin` failure in clean environments. `studio-plugin/package.json` dependencies (like `rbxtsc`) are now correctly installed via a nested `npm install` before running `rbxtsc`.
- **Lune Runtime Tests**: Fixed `test:plugin:runtime` by correcting the CLI command to `lune run tests/plugin-runtime-smoke.luau`. The script now also explicitly requires `@lune/process` and its pattern matching expectations have been corrected.
- **Security Documentation**: Updated `SECURITY.md` to explicitly clarify capabilities, boundaries, and limitations across different tool profiles.
- **Diagnostic/Telemetry Alignment**: Updated issue templates (`bug_report.yml`) and configuration documentation to correctly refer to "local anonymized diagnostic reports" instead of "telemetry", addressing user concerns about data collection implications.
- **Help Menus Standardized**: Added comprehensive `--help` flags and instructions to CLI scripts and plugins to ensure standardized discovery of options.
- **Prerelease Publishing**: Prerelease versions now publish to npm's `next` tag and create a GitHub prerelease instead of replacing the stable `latest` release.
- **Diagnostics Reliability**: Corrected session failure and per-tool statistics, bounded health probes with a timeout, and reported the actual mismatching Studio instance.
- **Multi-Instance Plugin State**: Version and protocol mismatch banners now remain visible until the final affected Studio connection disconnects or recovers.
- **Portable Tool Documentation**: Made documentation generation Windows-safe and corrected schema types, Markdown escaping, and empty parameter tables.
- **Release Evaluation Harness**: Added fresh-log guidance, semantic fixture targets, and reproducible model/provider metadata.
- **Plugin Build Dependencies**: Updated vulnerable transitive `ajv`, `fast-uri`, and `picomatch` versions in the Studio plugin lockfile; its npm audit now reports zero vulnerabilities.
- **Luau Execution**: Fixed plugin startup ordering and an unbalanced execution wrapper that broke `execute_luau`, runtime eval tools, and `scene_search` in the bundled plugin.
- **Lua Pattern Guidance**: Clarified that `grep_scripts` uses Lua patterns, where `|` is literal rather than regex alternation.

### Changed
- External quality tools are restricted to `BLOXFORGE_PROJECT_ROOT` (the process working directory by default); Lune scripts and Rojo outputs cannot escape that boundary.
- Bridge HTTP now binds to `127.0.0.1` by default; non-loopback binding requires explicit `ROBLOX_STUDIO_HOST`/`--host` opt-in and emits a warning. Global permissive CORS was removed.
- HTTP body parsing now accepts `MCP_HTTP_BODY_LIMIT` instead of hard-coding the 50 MB limit.
- Shutdown is now idempotent, stops accepting MCP activity, clears pending bridge requests, closes promotion timers and HTTP handles, and then exits.
- Publishing a GitHub Release now automatically builds and publishes both npm packages, then uploads fresh full and inspector Studio plugin assets.
- AI-agent guidance now requires every important change and fix to be recorded in the changelog.
- **Documentation Cleanup**: Removed stale release plans, duplicated host setup pages, demo scaffolding, and verbose workflow examples; retained the concise handbook, architecture, limitations, troubleshooting, and generated tool reference.

### Removed
- Removed legacy PNG brand assets and the tracked `.superpowers/` artifact; SVG assets are now canonical.

## [2.20.2] - 2026-07-08

### Added

- **Tool profiles.** Added `--profile core|builder|tester|full` via
  `BLOXFORGE_TOOL_PROFILE`, preloading task-relevant schemas while keeping the
  token-lean core default. `load_toolset` now explicitly documents that some MCP
  hosts require a client-side schema-selection step after `tools/list_changed`.
- **Wrapper tests: correct Lua pattern escaping.** Node and Lune smoke tests
  now match Lua/Luau `%w`: underscores are escaped, while letters and digits
  remain literal. Added `npm run test:plugin:runtime` for the Lune smoke test
  when the `lune` executable is installed.
- **Plugin: `fresh_require()` helper for stale `require()` cache.** Added a
  built-in `_G.fresh_require(module)` available inside every
  `execute_luau` / `execute_luau_async` call. After editing a `ModuleScript`'s
  `Source`, Roblox's per-instance `require()` cache returns the stale pre-edit
  copy, so edits look like they "didn't apply". `fresh_require()` clones the
  module under `Workspace`, requires the clone (new identity → no cache hit),
  then `Destroy()`s it. It is a verification tool, not a drop-in `require()`
  (different table identity; nested `require()` is not fresh; errors are raw) —
  see [docs/known-limitations.md](docs/known-limitations.md).
- **Plugin: dynamic `WRAPPER_LINE_OFFSET`.** The execute_luau wrapper's
  user-relative line offset is now derived from the rendered template (a probe
  with a sentinel counts preamble newlines) instead of a hand-maintained
  constant, so reordering the wrapper preamble can never silently desync
  `__mcp_LINE_OFFSET` / `remapPayloadLines` from the real line count.
- **CI: plugin compiled-output smoke check.** Added
  `tests/plugin-compiled-smoke.mjs` that asserts key invariants on the
  `rbxtsc`-compiled Luau (dynamic offset, fresh_require presence, renderWrapper
  template, recovery re-ready). Runs as `npm run test:plugin:smoke` locally and as
  a CI step after the existing `compile:plugin` job, so regressions in the
  compiled wrapper surface without needing a Studio runtime.
- **Documentation: Roblox-engine platform limits.** New
  [docs/known-limitations.md](docs/known-limitations.md) as the canonical
  reference for three dogfooded constraints: (1) `require()` cache by instance
  after `Source` edits, (2) catalog/uploaded audio (`rbxassetid://`) failing to
  load in Edit (`IsLoaded=false`, `TimeLength=0`; only `rbxasset://sounds/*`
  loads in Edit), (3) `Sound.PlaybackLoudness` always `0` in Edit. Surfaced the
  same limits in `SERVER_INSTRUCTIONS`, and in the `execute_luau`,
  `edit_script_lines`, `set_script_source`, `audio_create_sound`, and
  `playtest_sample_state` tool descriptions. Added [docs/README.md](docs/README.md)
  index and [docs/troubleshooting.md](docs/troubleshooting.md) symptom→fix guide.
  Removed the stale "library audio loads in Edit" note from the deleted `bugs.md`.
- **Upstream Chrrxs v2.21.0 parity slice: Studio instance management and MicroProfiler capture.**
  - Added `manage_instance` for launching baseplates/local files, inspecting/closing managed Studio instances, and listing Open Cloud place versions for revision launches.
  - Added `capture_micro_profiler` plus Studio plugin `/api/capture-micro-profiler` routing, `LibMP.lua`, raw snapshot export, summarized JSON export, and baseline comparison deltas for groups/timers/threads/call edges.
  - Added upstream-compatible aliases `solo_playtest`, `multiplayer_playtest`, and `generate_model` over this fork's existing runtime/model-generation architecture.
- **Dependency hygiene.**
  - Folded Dependabot PR #23 into this release: `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` now use `^8.62.1`.
  - Ran `npm audit fix` and added an `esbuild` override to `0.28.1`, reducing `npm audit` from 16 reported vulnerabilities to 0 while keeping the build/test suite green.
- **Dogfooded papercut fixes from gas-station tycoon MCP work.**
  - Lazy tool loading remains the **default** MCP path. `ROBLOX_MCP_LAZY_TOOLS=0`
    / `false` / `off` is the escape hatch for hosts that need all schemas upfront,
    while `doctor`, `/health`, and `get_session_summary` now make schema mode,
    loaded core state, and recent failures visible for reconnect debugging.
  - `/ready`, `/poll`, `/health`, `/status`, and `doctor` now surface protocol
    version metadata alongside plugin/server versions, so an updated npm package
    paired with an old Studio plugin is visible immediately.
  - Safety-gated Luau now reports the exact matched dangerous pattern(s), not just
    a generic confirmation request.
  - Added lightweight dogfood session telemetry (`get_session_summary` plus
    `/health.session`) that records tool name, duration, success/failure, and error
    code without capturing tool payloads.
  - Catalog search can mark legacy overlap tools with replacement metadata; public
    tools are not removed in this patch release.
  - Script editing no longer decodes literal `\n`, `\t`, `\r`, or escaped quotes in
    source/edit payloads. JSON already transports real newlines, so preserving
    backslashes prevents malformed string literals such as `"foo\nbar"` being split
    across lines. Script edit/insert/delete/find-replace paths also verify the live
    `ScriptDocument` draft after `UpdateSourceAsync`, preventing stale editor drafts
    from being mistaken for successful writes.
  - `diagnose_scripts` now states that it reads the current Studio output log only
    and that ModuleScript compile/load errors require a playtest restart/require
    before a clean result is trustworthy.
  - `simulate_keyboard_input` now accepts `holdDuration` as an alias for `duration`
    and forwards it all the way to the Studio plugin. `duration` wins when both are
    supplied, preserving the original parameter while accepting ProximityPrompt-style
    naming.
  - `capture_screenshot` now reports both physical image size and logical viewport
    size. When OS display scaling makes screenshot pixels differ from
    `simulate_mouse_input` coordinates, the response gives the exact conversion
    (`x = imageX / scaleX`, `y = imageY / scaleY`) instead of claiming 1:1 pixels.
    The Studio capture DM now returns `viewportW`/`viewportH`; tool descriptions no
    longer promise the image always matches the input coordinate space.
  - Playtest teardown is idempotent for Roblox's "EndTest can only be called once"
    failure mode. `multiplayer_test_end` and the cross-DM `stop_playtest` monitor now
    treat that signal as teardown already in progress (`success + alreadyEnded`)
    rather than failing and leaving the session stuck.
- **Upstream Chrrxs v2.21.0 parity slice: official Roblox docs.** Ported the
  isolated `get_roblox_docs` feature from upstream into this fork's split tool
  architecture, including cached markdown fetching, section extraction, a
  `robloxdocs://...` resource template surface, and helper tests. Larger upstream
  additions (`manage_instance`, `capture_micro_profiler`, monolithic playtest API
  renames) were identified but not merged wholesale because they conflict with this
  fork's round-6 toolset/resource/outputSchema architecture and need a separate port.
- **Track A — multi-provider CC0 asset discovery + provenance resource (round-6).**
  `asset_source_search` searches free, license-clean libraries OUTSIDE the Roblox
  marketplace and returns ONE normalized descriptor shape across providers
  (`{ provider, id, name, type, license, attributionRequired, pageUrl, downloadUrl?,
  thumbnailUrl?, note }`). Live search hits Poly Haven (textures/HDRIs/models) and
  ambientCG (PBR materials, with the preview PNG as a directly-importable
  `downloadUrl`); Kenney and Quaternius are returned as browse-only pointers (no
  search API). The flow is asset_source_search → pick → `import_external_asset` with
  the downloadUrl (uploads + records provenance). Studio-agnostic, all-CC0. The
  normalizers are pure and unit-tested against fixtures; the live fetch is thin and
  network-gated (same posture as import_external_asset). Per-provider failures are
  reported, not fatal.
  - Provenance is now also an **MCP resource**: `roblox://asset/provenance` (all
    records) and `roblox://asset/provenance/{assetId}` (one), backed by the existing
    `get_asset_provenance`.
- **outputSchema sweep — self-driving loop tools.** `run_playtest_episode`,
  `summarize_episode`, and `propose_next_action` now publish strict-ish
  `outputSchema`s (these outputs are owned by the server, so the contract is
  reliable). Each gets a representative sample in the output-schema-contracts test.
- **Track E — self-driving loop polish (round-6).** `propose_next_action` — a
  deterministic next-step picker over the stored playtest episodes, so the
  edit→playtest→observe→fix loop doesn't burn an LLM turn on the obvious move. With
  no `episodeId` it reads the latest episode (and finds the most recent earlier
  FAILING run, so a clean run after a failure is recognized as a fix to prove).
  Returns `{ action, done, tool, args, rationale, focus }`: names the exact MCP call
  when mechanical (run an episode, or `summarize_episode` with `comparedToEpisodeId`),
  else `tool=null` + the implicated scripts/assertions in `focus`. `summarize_episode`'s
  comparison block is now a **richer diff** (`diffEpisodes`): error-count delta,
  newly-introduced vs resolved error lines, and per-assertion pass/fail transitions —
  not just the verdict flip. Pure TS over the in-memory store (no plugin, no Studio),
  unit-tested.

### Changed

- **Renamed the product to BloxForge.** Public npm packages are now
  `@princeofscale/bloxforge`, `@princeofscale/bloxforge-inspector`, and the
  internal `@princeofscale/bloxforge-core`; CLI binaries, MCP service names,
  plugin UI/logging, docs, repository links, and diagnostics use the BloxForge
  brand. Legacy source-directory and environment-variable names remain accepted
  for compatibility.
- **Bridge diagnostics.** `/health` and `/status` now retain the ten most recent
  disconnects with reason (`plugin_request`, `stale_timeout`, or `unknown`), last
  activity, and disconnect timestamp.
- **Runtime reliability.** `stop_playtest` is now an idempotent no-op when no
  runtime peer is active, instead of waiting for a nonexistent play-server.
  Invalid UTF-8 produced by byte-sliced `execute_luau` output is replaced with a
  clear marker before JSON serialization, preventing 120-second bridge stalls.
- **Safe screenshot camera framing.** `capture_screenshot` accepts paired
  `cameraPosition`/`lookAt` values in Edit mode and always restores the previous
  CameraType and CFrame after capture.
- **Dogfood limitations reference.** Documented playtest wall-clock behavior,
  eval time windows, VM-local `_G`, runtime `GetDebugId` security, shared-log peer
  attribution, ModuleScript diagnostics/reload behavior, unique edit anchors,
  screenshot/input scaling, ProximityPrompt triggering, marketplace permissions,
  audio constraints, and safety confirmation behavior.
- **Bridge: WebSocket request delivery with polling fallback.** Studio plugins
  now prefer `HttpService:CreateWebStreamClient(WebSocket)` for immediate
  request delivery and same-stream responses. `/poll` remains the fallback
  before connection and after a close/error, preserving compatibility with
  older plugins and denied stream permissions. Failed stream sends release
  the request back to the normal queue.
- **Bridge: more resilient to Studio throttling.** The server now tolerates up
  to 90s of plugin silence before reaping an instance (was 30s), absorbing the
  `HttpService:RequestAsync` throttling gaps Studio imposes when its window is
  backgrounded/minimized — the most common cause of the bridge "dropping"
  mid-session. Configurable via `MCP_STALE_INSTANCE_MS`. The plugin also re-fires
  `/ready` immediately on the failing→ok poll transition, closing the window
  where a recovered plugin is still anonymous to the server.

### Fixed

- **Dependency bumps (dependabot #16–#20) + toolchain fixes.** Accepted all five open
  dependabot PRs and made the tree green again under the majors:
  - `typescript` 5.9 → 6.0, `@typescript-eslint/parser` + `eslint-plugin` 7 → 8,
    `supertest` 6 → 7 / `@types/supertest` 6 → 7.
  - TS 6.0 deprecates `moduleResolution: node` and changed `@types` auto-inclusion in
    workspaces: silenced the deprecation with `ignoreDeprecations: "6.0"` and pinned
    `types: ["node", "jest"]` in `packages/core/tsconfig.json`; bumped `@types/jest`
    29 → 30 (the `ts6.0`-tagged line) so jest globals resolve.
  - **ponytail:** dropped the `uuid` dependency entirely (9 → 14 was ESM-only and broke the
    jest transform) — the two `v4()` call sites now use Node's built-in
    `crypto.randomUUID()`. Fewer deps, no transform hacks.

### Removed

- Removed stale `bugs.md` and `todo.md`; release history lives in this changelog and
  regressions are covered by tests.

## [2.20.1] - 2026-06-23

### Added

- **External asset ingest — Track A first cut (research round-6, Q1).** Bring assets from
  OUTSIDE the Roblox marketplace into a place, with provenance:
  - `import_external_asset` — download a URL (or read a local file) → upload to Roblox via
    the existing Open Cloud `asset:write` path → record provenance (source, license,
    attribution obligation, sha256, new assetId) → optionally insert. For CC0/CC-BY libraries
    (Kenney, Quaternius, Poly Haven, ambientCG), own files, or any direct asset URL.
  - `get_asset_provenance` — return the recorded provenance (one assetId or all this session)
    to produce an attribution manifest or audit where assets came from.
  - **ponytail:** reuses the proven `uploadAsset` path rather than a new uploader; the
    multi-provider `asset_source_search`/`stage_external_asset` split is deferred (the import
    tool already takes a URL/file, so "found → import" is covered). Live Open Cloud upload
    dogfood pending credentials (`ROBLOX_OPEN_CLOUD_API_KEY` + creator id); the new
    download/hash/provenance logic is unit-tested. README documents key setup + scopes.
- **UI design quality — Track D first cut (research round-6).** Three tools turn "AI slop
  UI" into a build-canon + measurable gate + one-shot fix:
  - `ui_component_catalog` — the design system the agent should build against: theme tokens
    (spacing scale, radius, typography, dark/light colors, min text size), canonical
    component anatomies (button, card, modal, hud_meter, list_row, nav_rail), and concrete
    Roblox guidance (UIListLayout, Scale-over-Offset, 9-slice, gamepad Selectable).
  - `design_lint` — deterministic, scored UI linter. Flags tiny_text (<9px), offscreen
    elements, overlapping interactive elements, non_responsive_size (large pure-offset),
    no_layout_container (4+ children with no layout), and stretched_image_no_slice. A cheap
    reproducible design-quality metric. Live-dogfooded against a deliberately-bad UI (caught
    all rule classes, scored 54/100). Geometric checks use edit-mode layout; topbar/safe-area
    insets need a playtest.
  - `apply_theme` — standardizes an existing UI onto a theme (dark/light): recolors
    Frames/buttons/text to tokens, raises sub-readable text, removes hard borders, rounds
    corners. Live-dogfooded (raised 10/8px text to 14, applied primary, added UICorner).
  - `design_review` — vision UI critique. Temporarily stages a ScreenGui under CoreGui so it
    renders, screenshots the viewport, and asks a vision model (Pollinations OpenAI-compatible
    `/v1/chat/completions`, default `openai-fast`) to score visual hierarchy / spacing / color /
    alignment / "AI slop" and return specific Roblox-phrased fixes. Run after `design_lint`
    passes (lint = cheap deterministic gate; review = qualitative amplifier). Requires
    `POLLINATIONS_API_KEY`. Vision endpoint + model + CoreGui-render staging verified live;
    full tool dogfood pending an MCP server restart to load the new tools.
- **`generate_model_native` — native AI 3D model generation (research round-6, Track B).**
  New tool that generates a 3D model from a text prompt via Roblox's on-platform
  `GenerationService:GenerateModelAsync` and inserts it into the place, returning the
  model path, generation UUID, named parts, and bounding box. Free, moderation-aware, no
  external text-to-3D API or asset upload needed. Supports the `Body1` (single mesh) and
  `Car5` (five-part car) predefined schemas or a custom `parts` list (→ `SchemaDefinition`),
  plus optional `size`, `maxTriangles`, and `generateTextures`. Runs in ~30s (covered by
  the heavy-Luau 120s timeout floor). Live-dogfooded end-to-end (model with non-zero bbox
  and named MeshPart parts). **ponytail:** text-prompt path only — image-conditioning input
  deferred until asked. (External multi-provider text-to-3D and `EditableMesh` as a durable
  upload lane were deliberately NOT built — see research round-6: cost/licensing/replication
  make the native path the right first cut.)

### Changed

- Branding: replaced upstream `Chrrxs`/`chrrxs` references with `princeofscale` across the
  studio-plugin (credits label, update banner, install docs) and pointed the installers'
  release-download `REPO` at `princeofscale/bloxforge`. The release workflow now
  creates a GitHub release per tag and attaches both `.rbxmx` plugin variants, so the
  `--dev`/fallback download path resolves real assets.

## [2.20.0] - 2026-06-23

### Added

- **Track D — runtime episode loop, full.** Playtest episodes are now a first-class,
  addressable, comparable unit: `run_playtest_episode` persists each result in a capped
  in-memory store and returns an `episodeUri`; they're readable as resources
  (`roblox://playtest/episode/{id}` and the newest-first index `roblox://playtest/episodes`).
  New `summarize_episode` distills a stored episode (verdict, failed assertions, top error
  lines, implicated scripts, suggested next step) and — given `comparedToEpisodeId` — reports
  `fixed=true` on a fail→pass transition, so the agent can PROVE a fix across turns. (An
  autonomous `fix_from_episode` is intentionally not built — the MCP has no LLM; the loop is
  run → summarize/compare → agent edits with existing tools → re-run.)
- **Track G — reliability surface, full.**
  - **Evented resources / subscriptions (G3):** both transports advertise
    `resources: { subscribe: true, listChanged: true }`. On stdio, subscribing to an episode
    (or the episode list) gets `notifications/resources/updated` + `list_changed` pushed when
    a new episode is stored — no polling. Streamable HTTP accepts subscribe/unsubscribe for
    conformance but is stateless, so it can't push (documented).
  - **Tool-risk annotations (G4):** every tool advertises MCP `annotations` derived from its
    category + explicit sets — `readOnlyHint` (read vs write), `destructiveHint` (delete/clear/
    overwrite/bulk/import/reset), `openWorldHint` (marketplace/asset/image services) — so hosts
    can auto-approve reads and confirm destructive writes.
  - **Reproduction bundle (G2):** `get_reproduction_bundle` (+ `roblox://repro/bundle`) captures
    a point-in-time audit in one call — connected places, world overview, recent mutating
    operations, and stored episodes — for hand-off, auditing an agent run, or before/after deltas.
  - **Multi-place routing + conformance (G1):** documented the existing `instance_id` routing
    (required only when >1 place is connected; failures return the instance list) and the full
    capability/host matrix in `docs/host-conformance.md`.
- **`run_playtest_episode`** (research round-5, Track D) — one-shot runtime episode that
  starts a playtest, lets it run briefly (`durationS`, default 3s, max 30), gathers the
  evidence an agent needs (runtime error/warning counts + entries, optional gameplay
  `assertions`, an optional `sampleDomains` state sample), stops the playtest, and returns
  a single object with a **pass/fail/error verdict** (fail on any failed assertion or
  logged runtime error). Collapses the start_playtest → sample/assert/logs → stop_playtest
  loop into one call so an agent can drive an edit→playtest→observe→assert→fix cycle without
  hand-orchestrating the lifecycle. Composes the existing playtest primitives — no new
  plugin endpoint. Added eval case `runtime.episode_verdict` (accepts the one-shot or the
  hand-looped path) to measure the call-count delta. **ponytail:** returns the episode
  inline — the MCP resource plane (`roblox://playtest/episode/{id}`) and replay/
  fix_from_episode are deferred until dogfooding asks for them.
- **`plan_asset_insert`** (research round-5, Track E) — one-shot asset discovery that
  marketplace-searches a keyword, runs the authoritative insertability preflight on the
  top N candidates in a single batched call, and returns a ranked, vetted plan
  (insertable + free + script-free first, with per-candidate warnings). Collapses the
  search→preflight→search round-trip churn the eval flagged on asset-heavy builds into
  one call; the agent then inserts the recommended id with `insert_asset`. Added an eval
  case (`marketplace.plan_then_insert_vetted`) that accepts either the one-shot path or
  the old hand-looped path, so the tool-call-count delta is measurable. Plan-only by
  design — a batch-transactional `apply_asset_plan` is deferred until dogfooding shows
  demand (single `insert_asset` covers the common case).
- **Caching-aware eval metrics** (research round-5, Track B). The raw `bootstrapTax` /
  success-per-1k numbers over-state discovery cost for a prompt-caching client (Claude)
  and can't be compared cleanly against a non-caching one (deepseek). Added four
  trace-derived companions in `evals/metrics.ts`: `effectivePaidInput` (cache-weighted —
  reads 0.1×, 5-min writes 1.25× base; equals raw input when the provider doesn't cache),
  `warmBootstrapTax` (bootstrap tax in effective-paid tokens — the recurring per-task
  discovery cost a warm-cache client sees), `firstValidActionTokens` (tokens to the first
  non-error real action), and `recoveryCostAfterFirstError` (tokens burned after the first
  errored call — flags thrashing). The adapter now records the cache read/write token
  split per turn; each mode's summary prints all four; selfcheck covers them (12 graders).
- Made the `evals/` harness decision-grade: the runner now loads **every** `cases/*.json`
  bucket (was only `discovery.json` — 3 of 19 cases) and tags each case with its bucket;
  each mode prints a per-bucket success + mean-recall breakdown. Added a `scene_semantic`
  bucket (targets described by behaviour, not name) whose recall is the data-gated trigger
  to revisit embedding-based scene search (Track H).
- Added eval-run observability: on each server (re)start the harness now **waits for the
  Studio plugin to (re)connect** (polls `get_connected_instances` up to
  `EVAL_STUDIO_TIMEOUT_MS`, default 30s) and aborts with an actionable message — fixing a
  false "no Studio connected" when the plugin hadn't finished re-registering with the new
  primary server yet. Plus live progress logs (server spawn, advertised tool count, Studio
  instances seen, per-case `running…`/`PASS|FAIL` with recall/calls/bootstrap, each tool
  call), and the spawned server's stderr is inherited so its bridge/proxy-mode logs are
  visible.
- Added `.superpowers/` to `.gitignore`.
- Added CHANGELOG reminder to CLAUDE.md.
- Zeroed eslint warnings: added overrides for test files and client-coupled sources; `no-explicit-any` warnings eliminated.

### Changed

- **`playtest_sample_state` `world` domain de-noised** — it walked every `ValueBase`
  under Workspace/ReplicatedStorage/ServerStorage (cap 100), so a spawned player
  character flooded the result with ~100 rig-internal values (`*.OriginalPosition`,
  `*.OriginalSize`, `Animate.*` string values) — pure engine noise that also crowded out
  real game state before the cap. Now skips `ValueBase`s inside a player's character
  (`Players:GetPlayerFromCharacter` on the nearest Model ancestor). Found via live
  dogfooding the `run_playtest_episode` flow on a real place.
- **Lazy tool loading is now the default.** `ROBLOX_MCP_LAZY_TOOLS` flipped from
  opt-in to opt-out: unset => lazy; set `0`/`false`/`off` for the old upfront
  behaviour. Based on a decision-grade eval (OpenModel deepseek-v4-flash, median of
  3): lazy cut bootstrap tax −67% (31.8k → 10.6k input tokens) at **success parity**
  (84% vs 84%) and 2.5× success-per-1k-input. Upfront is kept behind the flag (strong
  models may still prefer seeing all schemas at once; the A/B harness needs both paths).
- Extracted `RuntimeTools` (`tools/runtime-tools.ts`, 1828 lines) — the final and
  most stateful domain split out of the `RobloxStudioTools` facade. Moves the
  runtime/playtest/eval/simulation surface: `execute_luau` (+async/job polling),
  `eval_*`, network + device-simulator state, runtime logs, script profiler,
  breakpoints, single- + multi-client playtest lifecycle, undo/redo, synthetic
  input, character navigation, screenshot/device-matrix capture, and the
  playtest-telemetry / gameplay-assertion QA primitives, plus all their private
  peer-routing/wait-loop/image-capture helpers. `_safetyGate` + `_runGeneratedLuau`
  stay in the facade (shared with other domains) and the gate + `recordOperation`
  are injected. Facade methods keep identical public signatures; `index.ts` −1685
  lines. All 419 tests green.
- Moved `data/logo.png` and `data/banner.png` to `assets/`; updated README references.

### Fixed

- **Plugin server-URL robustness (ported from upstream 2.17.1 "path resolution").**
  `ServerUrlSettings` now normalizes the server URL (adds a missing `http://` scheme,
  trims whitespace/trailing slashes) and remembers the last *successfully connected* URL
  globally + per-instance (with legacy-key migration), so a fresh/anonymous place
  reconnects to the right address. URL input is normalized on blur and on connect; the
  remembered URL is applied at plugin boot before the UI initializes. Also: `set_script_source`
  now verifies `UpdateSourceAsync` actually changed the source and errors loudly if it
  silently no-ops. (Did not port the upstream char-navigation removal or unused Luau
  path-quoting helpers — no consumer in this fork.)
- Made the eval numbers decision-grade after the first full 19-case run exposed three
  issues: (1) **fixed the `bootstrapTax` metric** — its boundary was "first world read",
  so tasks that never do one (marketplace inserts, grep-only scene search) mis-summed the
  *entire* run (500k+ tokens) and corrupted the mean; the boundary is now the first *real*
  (non-discovery) tool call, with `tool_catalog_search`/`load_toolset` counted as bootstrap.
  (2) **`EVAL_MAX_ITERATIONS`** (default raised 14→20) so a weak free model's thrashing
  isn't scored as a false FAIL. (3) **`EVAL_REPEATS`** — run each mode N times and gate on
  the across-repeat **median**, so one noisy draw doesn't decide the outcome.

### Removed

- Removed stale top-level docs (`SUPPORT.md`, `docs/safety.md`, `docs/roadmap.md`,
  `docs/troubleshooting.md`, `docs/marketing-checklist.md`); untracked the local-only
  `docs/superpowers/` artifact (already gitignored).

## [2.19.3] - 2026-06-21

### Added

- Published first-wave MCP `outputSchema` contracts for stable, object-shaped tools:
  discovery (`tool_catalog_search`, `load_toolset`), world-model reads
  (`get_world_snapshot`, `get_node_batch`, `get_changes_since`, `scene_search`),
  asset preflight, playtest telemetry, gameplay assertions, transactional mutation
  plans, and recipes. Responses remain dual-format: `structuredContent` for newer
  clients and the same JSON text block for compatibility.
- Added schema conformance tests with representative golden payloads so published
  contracts are validated in CI before they are advertised to MCP clients.
- **Declarative `ToolRegistry` + `defineTool()` + standard execution pipeline.**
  New `tool-pipeline.ts` keeps tool metadata, schemas, and handler together in one
  place. The pipeline wraps every call with structuredContent attachment and typed
  error envelopes (via errorEnvelope). First-wave contracted tools are registered
  through the pipeline; both stdio and streamable HTTP servers dispatch through the
  registry first, falling back to `TOOL_HANDLERS` for non-migrated tools.
- **Mirrored lazy tool loading to the streamable HTTP `/mcp` path.** The `ListTools`
  handler now uses the `ToolRegistry` (which respects `ROBLOX_MCP_LAZY_TOOLS`) when
  available, so the streamable HTTP endpoint also benefits from reduced bootstrap
  token costs. `listChanged` capability is advertised in lazy mode.
- Eval benchmark suite expanded to 15 cases across 5 buckets (discovery,
  marketplace, scene-read, mutation, runtime), up from 3 in discovery-only.
  Each case has typed gold tools, forbidden tools, and answer-fact checks.
- Added 12 unit tests for the declarative tool pipeline — `defineTool`,
  `ToolRegistry`, and lazy mode — now at 419 total tests.
- `get_asset_details` now normalizes responses from both OpenCloud and cookie
  auth paths into a structured shape with `creatorName`, `creatorId`,
  `isCopyLocked`, `isPublicDomain`, `price`, `voting`, and `assetTypeId` fields.

### Changed

- Centralized MCP tool-list shaping so stdio and streamable HTTP advertise
  `inputSchema`/`outputSchema` consistently from the same helper.
- Converted raw error returns across all major tool domains (`exportRbxm`,
  `importRbxm`, `getAssetDetails`, `marketplaceSearch`, `imageGenerate`,
  `imageGenerateAndUpload`, `captureScreenshot`, `getScriptSource`,
  `environmentSetLightingPreset`) to use `toolErrorResult()`, so every tool
  surface returns the uniform typed error envelope instead of opaque error strings.
- **Extracted `AssetTools` domain class** from the facade (`index.ts` −1129 lines).
  Moved 20 asset/build/marketplace/image tools and all private helpers
  (normalizePalette, normalizeBuildParts, computeBounds, findLibraryPath,
  _generateImageToFile, resolveImageId) into `asset-tools.ts`. Same delegation
  pattern as SceneReadTools / ScriptTools / MutationTools — signatures and
  `instance_id` invariants unchanged.

## [2.19.2] - 2026-06-21

### Changed

- **Eval-validated lazy tool loading.** First real A/B run of the `evals/` harness
  (deepseek-v4-flash via OpenModel, discovery cases) confirms `ROBLOX_MCP_LAZY_TOOLS`
  pays off: mean bootstrap tax dropped **77%** (187k → 43k input tokens) with **no
  success regression** (67% → 67%) and ~5× better success-per-1k-tokens. The bottleneck
  is upfront tool-schema tokens (which lazy loading cuts), not lexical search recall —
  so the embeddings/semantic-search upgrade stays parked until an eval shows a real
  lexical-recall ceiling.
- **Domain-split of the `index.ts` facade (maintainability).** Extracted three more
  domain classes — `SceneReadTools` (14 read/inspect tools), `ScriptTools` (8 script
  tools), and `MutationTools` (19 scene-write tools) — each delegated from the facade
  with identical public signatures, so the tool surface and `instance_id` schema-parity
  invariants are unchanged. `index.ts` dropped ~605 lines (3983 → 3378). No behavior
  change; 387 unit tests green. (Asset + Runtime domains remain inline, deferred to a
  separately dogfooded pass — they're the most client-coupled.)
- Synced all package versions + the bundled Studio plugin to 2.19.2 (clears the
  plugin/server version-mismatch banner after a Studio restart).

## [2.19.1] - 2026-06-21

### Added

- Reworked the `evals/` harness to drive any Anthropic-Messages-compatible model: the runner auto-detects the provider from the environment (`OPENMODEL_API_KEY` → OpenModel gateway with the free `deepseek-v4-flash`, else `ANTHROPIC_API_KEY` → the real Anthropic API), with `EVAL_MODEL` / `*_BASE_URL` / `EVAL_REQUEST_DELAY_MS` knobs. The adapter drops the gateway's unsolicited `thinking` blocks from replayed history and retries 429s with backoff. Lets the eval suite run for free against `deepseek-v4-flash`.
- Added `run_gameplay_assertions` — run named boolean checks against the DataModel and get structured per-assertion pass/fail + an `allPassed` summary (the prove-the-fix QA primitive; pair with start_playtest + target="server" to assert live runtime state). Research review #7 (fix→verify loop).
- Added `list_recipes` + `apply_recipe` — typed, proven, idempotent build macros (proximity_door, ambient_sound, kill_brick) the agent picks by id + params instead of re-synthesizing gameplay Luau. Re-running replaces named instances rather than duplicating. Research review #5; higher success and fewer tokens than ad-hoc generation.
- Added `apply_mutation_plan` — transactional batch edits in one round-trip (set_property primitives, set_attribute, add_tag, remove_tag) with a `dryRun` diff, per-op before/after, and a ready-to-run `rollback` reverse plan in the receipt (stateless — the rollback is itself a mutation plan, no server handle/TTL). Large plans gate on `confirm` via the safety layer's object-count limit (new `bulk_mutate` op kind). Research review #4; ops travel as JSONDecode data (injection-safe). Verified live (dry-run).
- Added `playtest_sample_state` — sample LIVE runtime state during a playtest: players (position/health/team/tool/humanoid state), named world state in `ValueBase` objects, currently-playing audio, and runtime/role flags. Domain-masked; defaults to `target="server"`. The top Roblox-specific frontier from the research review — turns the MCP from a scene editor into a runtime-aware debugging surface. Verified live.
- Added an MCP **resources** data plane (research review #2) over the existing world-model tools — the same data as cacheable canonical URIs, exposed from both the stdio and HTTP `/mcp` servers: `roblox://world/snapshot?view=overview|standard`, `roblox://node/<dot.path>`, `roblox://world/changes?since=<snapshotId>` (+ resource templates). Lets hosts (Cursor, Codex) read and reuse world state independently of the tool surface; a thin layer on top of the snapshot-store, tools unchanged.
- Server now returns MCP `instructions` at initialization (the cross-tool workflows — inspect→drill-down→refresh, marketplace discover→preflight→insert, dry-run→confirm, async-Luau polling, typed-error branching — stated once server-wide instead of duplicated per tool). Hosts like ChatGPT read these alongside tool metadata.
- Every tool now also returns `structuredContent` (the machine-readable object channel) alongside the existing text block, applied centrally at dispatch when the payload is a JSON object — backward-compatible dual-format output, no strict `outputSchema` declared (which would break mixed clients). Contract-plane groundwork from the post-2.19.0 research review.

## [2.19.0] - 2026-06-20

### Added

- Added `scene_search` — a ranked, multi-signal "where is X" search (research review's #7, the pragmatic no-vector form): scores each instance across name, tags, attribute keys, parent name, and class, returning the top matches with a score and matched terms. Answers "find the door system", "where is the shop UI", "what controls day/night" — more intent-aware than the single-field `search_objects`. Verified live.
- Added an **eval harness** under `evals/` (research review's #6) to measure optimizations objectively instead of by feel: pure trajectory/token metrics (`bootstrapTax`, tool-selection precision/recall, unnecessary calls, success-per-1k-tokens), a paired A/B `runSuite` (`upfront` vs `lazy`) with CI `evaluateGates` (success must not regress; bootstrap tax must drop), a provider-agnostic `McpHarnessAdapter` interface, a benchmark case set, and a deterministic `selfcheck.ts` for the graders.
- Marketplace search is now a **provider abstraction** (second research review's #5): the proven key-free public toolbox **v1** stays the default, while the official Creator Store **v2** (`/v2/assets:search`, currently Beta / Not Recommended) can be opted into via `ROBLOX_MARKETPLACE_PROVIDER=v2` or a constructor option, with automatic fallback to v1 if v2 errors. `buildV2SearchUrl` + a defensive `parseV2Results` are unit-tested. `asset_preflight_insert` remains the source of truth for insertability regardless of provider. No runtime change by default.
- Async Luau jobs now support **cooperative progress**: server-generated long-running Luau can call `_G.__mcp.progress(done, total, message, stage)` and `_G.__mcp.checkCancelled()`, and `get_job_status` surfaces `progress`/`total`/`stage`. Concurrency-safe via a `coroutine.running()` → job-id binding (no clash between parallel jobs). Per the second research review, this is an opt-in sanctioned API — NOT auto-injected into arbitrary user Luau. (Requires plugin reinstall + Studio restart.)

### Changed

- Every tool now surfaces a uniform typed error envelope on failure ("envelope by topology"): the CallTool dispatch in both the stdio server and the HTTP `/mcp` server wraps any thrown error via `toolErrorResult`, so the agent always gets `{ ok:false, error:{ code, message, retryable, suggestedRecovery, stage } }` with a stable code instead of an opaque internal error — without per-handler changes. (Full `outputSchema`/`structuredContent` on every tool remains a follow-up.)
- `get_changes_since` now diffs **three signature channels per node** — `structure` (class/parent/name/childCount), `semantics` (domain-specific properties: BasePart geom/material/anchored, Sound id/playing/looped/volume, scripts enabled/source-length, lights), and `meta` (tags + attributes) — keyed by a **stable per-session node id** (`GetDebugId`) instead of a fragile path. Changed nodes now report *which* channels moved, so an agent sees the kind of change (a re-parent vs a material tweak vs a tag) instead of a blind "childCount differs". Verified live (GetDebugId/Source/GetTags/GetAttributes all pcall-guarded). Second research review's #2.
- `tool_catalog_search` now returns a machine-readable `recommendedToolsets` block (domain + recommended tools + the exact `load_toolset` call to make) and a `client_hint`, so an agent/lazy client knows to load a domain instead of guessing. Bootstrap-contract from the second research review; deferred loading stays stdio-only (the HTTP `/mcp` path keeps the full, stable, non-side-effectful tool list).

## [2.18.0] - 2026-06-20

### Added

- Added `get_changes_since` — an incremental changefeed: captures a cheap world fingerprint (path -> class|child-count) and returns the added/removed/changed instances since a prior snapshot, so an agent refreshes only what moved instead of re-pulling the world after each action. First call returns a `snapshotId` baseline; subsequent calls diff and roll the baseline forward. New pure `world-changes.ts` (diff + bounded `SnapshotStore`) and `world-fingerprint.ts` generator.
- Added async Luau jobs — `execute_luau_async` returns a `jobId` immediately and runs heavy code in a plugin-side coroutine; `get_job_status` / `get_job_result` poll it; `cancel_job` flags it (best-effort). This removes the false-timeout class on long execute_luau calls: every individual MCP call returns fast while the work happens between polls. New plugin modules `JobRegistry` + `JobHandlers` (bounded registry, runs the same `LuauExec.execute` path). **Requires a plugin reinstall + Studio restart to take effect.**
- Added `asset_preflight_insert` — an authoritative pre-insert check that loads an asset with `AssetService:LoadAssetAsync` (the modern replacement for `InsertService:LoadAsset`, which supports third-party assets) into an isolated, unparented container, inspects it (root summary, descendant + script counts), and destroys it without touching the scene. Returns `insertabilityVerdict` with a typed error code (`AUTH` for copy-locked/unowned assets) and `hasScripts` as a safety signal. Verified live: even a `isFree` asset can return `AUTH`, confirming a real load — not metadata — is the source of truth for insertability.
- Added `get_world_snapshot` — a token-lean world model (place info, descendant/tag/sound/script counts, top classes, notable subtree roots, environment summary) for reasoning before drill-down, and `get_node_batch` — read several instances' chosen fields in one round-trip (compact value serialization) instead of a cascade of per-instance reads. Both run via execute-luau (no plugin change) and were verified live against a connected place; `Lighting.Technology` is read through pcall since it throws under PluginSecurity.
- Added `load_toolset` + opt-in deferred tool loading (`ROBLOX_MCP_LAZY_TOOLS=1`): the stdio server advertises only a small always-on core (the meta + critical-path tools) upfront and expands the advertised list as the agent calls `load_toolset` for a domain, emitting `tools/list_changed`. Off by default (full catalog), so existing clients are unaffected. Without the flag, `load_toolset` just reports which tools a domain contains.
- Added `tool_catalog_search` — a token-lean discovery tool that searches the server's own tool catalog by task/domain and returns compact, ranked matches (name, domain, read/write, when-to-use, required args) without loading every tool's full schema. New `tool-catalog.ts` module classifies all tools into semantic domains (scene, mutation, scripts, runtime, assets, ui, environment, terrain, build, media, sync, safety, core) with `expandToolsets()` groundwork for future on-demand toolset loading.
- Surfaced `isFree` and `hasScripts` on marketplace search results so an agent can judge a candidate (and avoid copy-locked/paid models that fail `LoadAsset`) before inserting.
- Documented the token-saving inspect workflow (`get_scene_summary` → `fields`/`limit`/`offset` drill-down) and the marketplace discover → analyze → insert loop in the README.

### Changed

- Extended the typed-error system (research review track 6): added `CONFIRMATION_REQUIRED`, `AMBIGUOUS_TARGET`, `INVALID_ARGUMENT`, `UNSUPPORTED_CLASS`, `INSERT_NOT_PERMITTED`, `RESOURCE_TOO_LARGE`, and `BETA_FEATURE_REQUIRED` codes (auto-classified from messages, so existing `typedError`/`responseErrorCode` call sites benefit immediately), plus `isRetryable(code)` and an `errorEnvelope()` builder that attaches `retryable` + `suggestedRecovery` for a uniform, agent-branchable failure shape.

### Fixed

- Fixed `marketplace-client` `parseDetails` to read the real live toolbox field names (`asset.typeId`, `fiatProduct.isFree`) instead of the older synthetic ones (`assetTypeId`, `product.price`), so asset type and free/paid status are now correctly enriched onto search results. Verified against a live `items/details` response.

## [2.17.0] - 2026-06-19

### Added

- Added `limit`, `offset`, and `fields` response shaping for `get_descendants` and `search_objects`.
- Added `get_scene_summary` for token-lean scene aggregation by descendant class.
- Added `breakpoints` for MCP-managed Studio debugger breakpoints with persisted registry and log breakpoint support.
- Added `capture_script_profiler` for focused short ScriptProfilerService captures on server or `client-N` peers.
- Added focused tests for response shaping and scene summary Luau generation.
- Added domain-specific tool definition modules under `packages/core/src/tools/definitions/`.
- Added `runtime-support`, `GeneratedBuilderTools`, and `SyncTools` modules to start shrinking the monolithic tool facade.
- Added this changelog.

### Changed

- Changed `get_instance_properties` to omit script `Source` by default; callers can pass `excludeSource: false` or use `get_script_source`.
- Changed runtime logging to seed buffers from `LogService:GetLogHistory()` so early playtest logs are available through `get_runtime_logs`.
- Changed playtest output handling to use `get_runtime_logs` instead of separate playtest/output log buffers.
- Changed `packages/core/src/tools/definitions.ts` into a 31-line compatibility aggregator that preserves `TOOL_DEFINITIONS`.
- Changed `packages/core/src/tools/index.ts` to delegate generated builder/template tools and local sync tools to domain classes.
- Changed `todo.md` to track unresolved work only.

### Removed

- Removed legacy `get_playtest_output` and `get_output_log` tools.

[unreleased]: https://github.com/princeofscale/bloxforge/compare/v4.0.1...HEAD
[4.0.1]: https://github.com/princeofscale/bloxforge/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/princeofscale/bloxforge/compare/v3.0.0...v4.0.0
[3.0.0]: https://github.com/princeofscale/bloxforge/compare/v2.20.2...v3.0.0
[2.20.2]: https://github.com/princeofscale/bloxforge/compare/v2.20.1...v2.20.2
[2.20.1]: https://github.com/princeofscale/bloxforge/compare/v2.20.0...v2.20.1
[2.20.0]: https://github.com/princeofscale/bloxforge/compare/v2.19.3...v2.20.0
[2.19.3]: https://github.com/princeofscale/bloxforge/compare/v2.19.2...v2.19.3
[2.19.2]: https://github.com/princeofscale/bloxforge/compare/v2.19.1...v2.19.2
[2.19.1]: https://github.com/princeofscale/bloxforge/compare/v2.19.0...v2.19.1
[2.19.0]: https://github.com/princeofscale/bloxforge/compare/v2.18.0...v2.19.0
[2.18.0]: https://github.com/princeofscale/bloxforge/compare/v2.17.0...v2.18.0
[2.17.0]: https://github.com/princeofscale/bloxforge/compare/v2.16.3...v2.17.0
