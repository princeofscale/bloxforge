# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Bulk write tools return a receipt instead of a row per input. `mass_set_property`
  on 200 paths answered with 200 rows of
  `{path, success: true, propertyName, propertyValue}` — repeating on every row
  the property name and value the caller had supplied once for the whole call —
  which measures about **6,600 tokens to say "all 200 succeeded"**. The receipt
  says it in 31. `mass_delete_objects`, `mass_create_objects`,
  `mass_get_property` and `bulk_set_attributes` get the same treatment.

  The compaction is lossless by construction, and derived rather than a list of
  field names to keep in step: a key whose value is identical on every
  successful row is stated once and dropped from the rows, and if that leaves a
  row as nothing but its path, the rows go — the caller sent that list, every
  failure is named, so "which ones succeeded" is "the ones I sent, minus these".
  The moment rows genuinely differ the hoisting stops and the rows stay, which
  is why `mass_get_property` keeps its per-path values. Failures always keep
  full per-row detail; a response whose shape this does not describe (nothing
  succeeded, no `success` flag, rows that are not objects) passes through
  untouched. The sentence explaining the receipt lives in the tool description,
  where it is paid once per conversation, rather than in every response.

  The plugin protocol is unchanged — the compaction is server-side, because the
  expensive wire is the one to the model, not the loopback one to Studio.

- `get_spatial_layout` separates what it measured from what it guessed. Bounds,
  the occupancy grid and the SpawnLocations are facts; `ground` never was — it
  is "the largest flat surface", which picks a roof or an upper storey whenever
  one is wider than the floor beneath it, and it arrived looking exactly as
  authoritative as the measurements beside it. An agent reading `ground.topY`
  would place a level 200 studs in the air and have no way to know. The rule had
  already been caught out once in testing by a 390x300x2 wall, which is why the
  flatness check exists.

  It now returns `inferred: true`, a `confidence` (never 1 — it is a guess), and
  a `basis` naming the evidence. The score is deterministic and each signal is
  something a person would check by eye: a SpawnLocation resting just above the
  surface raises it, since players are put on the floor; a rival flat surface of
  comparable area lowers it, because that is what a second storey looks like; a
  large flat surface *below* it lowers it, because that is what being a roof
  looks like. The Lune harness asserts both ends — a plain baseplate scores 0.90,
  and a 500x2x500 roof over it still wins on area, as the rule is written, but
  scores 0.25 and says why. The reader-facing instruction ("below about 0.5,
  confirm the floor another way") lives in the tool description, paid once per
  conversation rather than in every response.

### Added
- **Integration Pack SDK** (`packages/core/src/integrations/pack.ts`) — four
  tools for every third-party integration instead of a tool set each:
  `integration_inspect`, `integration_plan`, `integration_apply`,
  `integration_validate`.

  The alternative was the reason to build it. Three tools per library —
  `adonis_install`, `pesde_add`, `fusion_generate_component` — is not an
  integration but a tax: the catalog already costs about 50k tokens per request
  in full mode, and every library would widen that for every agent on every
  call, including the ones that never touch it. Four tools total cost 1.9k once;
  a pack after that adds a row to `integration_inspect`, not four rows to the
  catalog. Core stays at 4,849 tokens, inside its 6,000 budget.

  The repository invariants live in the engine rather than in each pack. A
  `planHash` covers the pack version, the request by content, the ordered steps,
  every file the plan depends on, and every remote identity it resolved — so a
  plan that pinned release 1.2.3 stops applying the moment that tag means
  something else. Each step's files are re-read immediately before that step
  runs, not only once at the start, because step one can take a minute and step
  three's file can move inside it. A step that makes a decision rather than
  restoring declared state comes back `blocked` naming what would permit it, and
  is never run. A plan whose step touches a file the plan never recorded is
  rejected at plan time — otherwise reread-before-write is defeated by omission
  rather than by edit. `validate` treats an `unknown` blocking check as a
  failure, on the same grounds as the asset gates: a check that could not run is
  not a check that passed.

  Each pack declares its own licence and the primary source it was written
  against, because a pack that installs somebody else's code has to say under
  what terms, and a reviewer needs to know what to check it against.
  `PACK_EFFECT_CEILING` bounds what any pack may declare and excludes every
  `studio.*` effect — which is what lets the four tools be exempt from the
  `instance_id` requirement without that exemption being an assumption.

  The `root` argument is clamped to `BLOXFORGE_PROJECT_ROOT`. `resolve(base,
  '/etc')` is `/etc`, so an absolute `root` would otherwise discard the base
  entirely — and the engine's own containment check could not catch it, because
  it measures paths against whatever root it is handed. Relative paths inside a
  pack resolve against that root too, so the check and the read never look at
  two different files. `complete` is true only when at least one automatic step
  ran: a plan of nothing is reported as nothing, not as success.

- **pesde integration pack** — a second package provider beside Wally rather
  than instead of it, and the first evidence that the pack SDK carries more than
  one pack: it adds **zero tools**, only a row in `integration_inspect`.

  Verified against the primary source rather than remembered, because the
  equivalent assumption about Wally was wrong. `pesde install --locked` **does**
  exist (`docs/reference/cli.mdx`: "whether to error if the lockfile is out of
  date"), so pesde needs none of the lockfile-backup workaround that released
  Wally 0.3.2 forced. The file names come from `src/lib.rs`
  (`MANIFEST_FILE_NAME`, `LOCKFILE_FILE_NAME`), and the manifest shape —
  `[target] environment` ∈ `luau`/`lune`/`roblox`/`roblox_server`, `{ name, … }`
  for pesde dependencies and `{ wally, … }` for Wally ones — from
  `docs/reference/manifest.mdx`.

  Installing with a lockfile is a repair and runs; installing without one
  resolves versions, which is a decision and comes back **blocked**. Validation
  fails a missing lockfile (two machines otherwise get different code from the
  same manifest), a registry dependency with no version, a dependency naming an
  undeclared index — checked against the *right* index table, since pesde and
  Wally indices are separate and crossing them would clear a name that was never
  declared for that provider — a `[target].environment` whose code does not run
  in a place, and a `pesde` found only on PATH.

- **roblox-ts integration pack** — the first pack, and mostly `inspect` and
  `validate` on purpose. BloxForge already compiles its own Studio plugin with
  roblox-ts but did not recognise a *user's* rbxts project as a distinct kind of
  project, so an agent that landed in one edited the generated `.luau`: the edit
  worked, and the next compile deleted it with no error anywhere.

  Four checks, each naming a way that happens:

  - `project-local-compiler` — `node_modules/.bin/rbxtsc` or nothing. A bare
    `rbxtsc` on PATH is deliberately not a fallback; a globally installed
    compiler and the one this project's lockfile resolved are different
    programs, and preferring whichever is on PATH is how a build stops being
    reproducible without anybody choosing that.
  - `no-handwritten-luau` — Luau at the root of `outDir` with no `.ts` under
    `rootDir` was written by hand into the compiled tree and is about to vanish.
  - `compiler-plugins` — an unlisted plugin **fails** rather than reporting
    unknown: the plugin is right there in the tsconfig, and what is missing is
    the approval, not the information. `request.allowedPlugins` approves by name.
  - `rojo-mounts-out-dir` — `unknown`, never `pass`, when the project file
    cannot be read.

  Detection requires both a `roblox-ts` dependency and a tsconfig that parses,
  not either — a tsconfig alone is an ordinary TypeScript project. The declared
  range and the installed version are reported as two facts, because `^3.0.0` is
  what the project asked for and `3.0.0` is what would actually run. `npm
  install` comes back **blocked**: it resolves and can rewrite the lockfile,
  which is the user's state.

  Verified against the primary source — roblox-ts `package.json` at master
  (3.0.0), `"bin": { "rbxtsc": "out/CLI/cli.js" }`.

- Asset provenance completeness and style ranking with hard gates
  (`packages/core/src/assets/provenance.ts`), roadmap C3.

  **`unknown` blocks.** An unread licence is not a permissive one, an asset
  whose permission state has not come back is not an approved one, and a model
  whose scripts were never examined is not a safe one. `licenseAllowed`,
  `permissionAllowed` and `scriptRiskAllowed` each block on `unknown` exactly as
  they block on `no`, and the wording keeps the two apart so a reader knows
  whether to go and look or to give up. Treating unknown as permission is how a
  pipeline ships something nobody ever decided to ship.

  A blocked candidate is **not ranked low, it is not ranked** — returning it at
  position nine with a good style score invites the exact mistake the gates
  exist to prevent.

  The provenance audit reports which of the roadmap's fields are present and
  which are missing, with four essential ones below which a record cannot answer
  the question it exists for. A partial record that names its gaps is useful; one
  that reports itself complete is not, and an empty string or empty list counts
  as absent rather than as filled in.

  Style scoring **drops an absent signal and names it** instead of defaulting
  it. Scored as 0 a missing embedding pushes a candidate down for a reason that
  has nothing to do with the candidate; scored as 1 it pushes it up for the same
  non-reason. The remaining weights are renormalized, so two candidates measured
  on different signals are not silently compared on different scales.
- The vision-QA policy and camera plan (`packages/core/src/vision/`), roadmap
  B3. **Vision proposes, it never disposes.** The published evidence is that VLM
  judges rank far more reliably than they score — absolute intervals move
  substantially with the visual task, and compositional biases are common across
  multimodal models — so a score from one look at one render is not a fact about
  the scene, and a pipeline that treats it as one will confidently rewrite good
  work.

  A finding may become a plan only when it is localized to an instance or
  region, an independent deterministic check confirms it, and it reproduced in
  at least 80% of identical runs. Even then "auto-fixable" means it has earned
  the right to become an ordinary plan with expected values and validation —
  nothing in this module writes. A finding a deterministic check *disagreed*
  with is discarded, since that check is reproducible by construction and the
  judge is not. Everything that fails the bar without being contradicted becomes
  a warning rather than being dropped, because noticing things is the half of
  vision QA that works. A repeat rate from a single run is refused outright: one
  run gives 1.0 or 0.0 and means neither.

  Ranking is pairwise and reports the pairs the judge decided both ways instead
  of averaging them, because the average of an unstable comparison looks exactly
  like a confident one.

  Camera selection reads the semantic graph rather than orbiting a ring, which
  photographs walls in an interior: objectives, spawns, dead ends and the
  approaches to high-betweenness portals, with each interpretation's confidence
  riding along so a shaky guess cannot outrank a measured objective. Six
  canonical views, then greedy additions until the next earns under 5% new
  coverage — and the nodes no camera covers are named, not folded into a
  percentage that reads as success.
- A checked design-token contract, roadmap B4. `apply_theme` now stamps the
  token *role* it applied — `BloxForgeBgToken`, `BloxForgeFgToken`,
  `BloxForgeTheme` — and `design_lint` reads them back and compares them against
  the **rendered** value.

  That comparison is the point. Without a reference back to the role, "this
  button is #4263EB" and "this button is the primary colour" are the same fact,
  and nothing can afterwards tell a deliberate one-off from a token that drifted
  — either because someone edited the instance by hand or because the palette
  moved under it. A check that compares a token to itself always passes, which
  is what "the theme was applied" has meant until now.

  `token_drift` names the rendered colour and the token's colour side by side.
  A role the theme does not define and a theme this build does not have are
  reported as their own findings rather than silently skipped, because "no
  drift" and "not checked" must not read alike. Colours are compared in 8-bit
  channels: `Color3` round-trips through floats, and exact float equality would
  report drift on every value that survived serialization unchanged. The lint's
  token table is emitted from `THEMES` rather than duplicated, so a palette edit
  cannot leave it checking against yesterday's values.
- The semantic scene graph (`packages/core/src/scene/semantic-graph.ts`),
  roadmap B1, as **two layers rather than one**. Facts are measured — zones,
  portals, widths, clearances, vertical deltas, and the share of shortest
  spawn-to-objective routes each portal carries. Interpretations are concluded —
  dead ends, bottlenecks, unreachable objectives — and every one arrives with a
  confidence below 1, the evidence behind it, the algorithm version that
  produced it and the source revision it was computed from. This is the
  correction `get_spatial_layout`'s inferred floor needed, generalised: a
  conclusion returned in the same shape as a measurement invites an agent to
  act on a guess with the confidence it would give a fact, and one with no
  version or evidence cannot be re-checked later, only believed or ignored.

  Bottlenecks use edge betweenness restricted to spawn x objective pairs —
  the share of shortest routes through each portal — and the interpretation says
  plainly when that share proves nothing: with one spawn and one objective every
  portal on the single route scores 1.0, so the confidence drops to 0.3 and the
  evidence says why. A zone with one *incident* portal is a dead-end candidate —
  incidence rather than outgoing edges, because a one-way portal into a room
  leaves it with no outgoing edge at all and a directed degree test skips the
  most dead-end-shaped thing in the graph. A teleport or a large vertical delta
  lowers the confidence, since each is a way out the graph cannot see; a
  one-way portal *into* the zone raises it, because that restricts direction
  rather than hiding a route. A spawn or objective zone
  with one portal is not reported at all: an entrance corridor and a vault at
  the end of one are normal level shapes, and a finding list that is mostly
  noise is one an agent learns to skip.
- The stage snapshot coordinator (`packages/core/src/stage/coordinator.ts`),
  roadmap D3. The eight steps come in a specific order and the order *is* the
  safety property, so it is a state machine that refuses to skip one rather than
  a documented procedure someone follows.

  Two of the orderings are load-bearing. The snapshot is serialized **before**
  the recorded write opens, because a `ChangeHistoryService` recording cannot
  safely span an await — held open across a yield it blocks the user's own edits
  and can be left dangling when the job is cancelled, which is why
  `/api/execute-luau-async` is already a declared exception in the undo-coverage
  audit. And the live reread happens before the snapshot, so the snapshot
  corresponds to a state someone measured rather than to whatever the scene was
  when serialization got round to it.

  An apply without a snapshot is refused: the coordinator exists so a failed
  apply has somewhere to go back to, and one that runs without a snapshot has
  quietly opted out of that. A zero-byte or unhashed snapshot is refused for the
  same reason — it would give the failure path something to restore from that
  restores nothing, and report success for doing it.

  **Rollback is a plan, not a privileged undo.** It carries the digest it
  expects to find, and a scene that moved between planning and running the
  rollback stops it and asks: most likely a person was reacting to the same
  failure, and restoring over them is exactly what an undo would do. A restore
  that does not bring the baseline digest back is not reported as done. Gates
  follow the same rule as the acceptance contract — an `unknown` is not a pass,
  and an empty gate list does not pass vacuously.

  The snapshot never enters model context: it is a URI, a hash and a size.
- The place journal, three-way drift detection and the stage acceptance
  contract (`packages/core/src/journal/`), roadmap B5 and D2.

  **Three-way, not two.** If the live scene differs from the plan, a two-way
  diff knows only that they differ — not whether the plan is stale or someone
  edited the scene since. Those want opposite responses, and guessing wrong
  either discards a user's work or re-applies a change they deliberately
  reverted. The third side is the journal baseline. Divergence on an owned path
  stops the write and comes back as `adopt`, `replan` or `review`; it is never
  resolved automatically, because every automatic answer destroys one side of a
  disagreement between a person and a machine. A duplicated id offers only
  `review` — there is no single current state to adopt.

  **The journal refuses to choose where it lives.** A Studio-only place has two
  surfaces and they are not interchangeable: plugin settings are machine-local,
  so a teammate opening the same place sees no history, and DataModel metadata
  is shared with the place, so writing history modifies the artefact being
  recorded. There is no default; the error names both. A torn last line is
  tolerated, since an append can be interrupted, but damage anywhere else is
  refused — a baseline with holes that reports itself complete is worse than no
  baseline.

  **An `unknown` hard invariant is not a pass.** Every audit this repository has
  had to repair failed by reporting success for something it never examined, and
  an acceptance contract is where that costs most, because it is the thing that
  says "ship it". A soft gate may be `unknown` — a vision rubric that could not
  be rendered is a missing opinion, not a violated rule — and the wording keeps
  "could not be evaluated" distinct from "was evaluated and was wrong". A
  contract with no gates cannot be satisfied, and one evaluated against a
  different revision is reported inapplicable rather than failing.
- A stable identity and ownership plane for generated instances
  (`packages/core/src/identity/`), the roadmap's D4/D5.3 contract. Four features
  need to answer "is this still the thing I made, and may I touch it" — the
  place journal, scatter reconcile, stage rollback and asset insertion — and
  without one contract each invents its own drift detection and they disagree at
  the worst moment.

  `groupKey` hashes generator, version, seed, canonicalized parameters, source
  and style profile; `itemId` hashes that with a **stable module slot** — a grid
  cell or named socket, never an array index, because inserting one item at the
  front renumbers every index below it and a reconcile then deletes and
  recreates a scene that did not change. Parameters are canonicalized with keys
  sorted at every depth, so `{a,b}` and `{b,a}` are one configuration; array
  order is kept because for a parameter list the order is the value; hash inputs
  are length-prefixed so generator `tree` in zone `line1` cannot collide with
  `treeline` in zone `1`.

  `planReconcile` only ever modifies or deletes instances carrying
  `BloxForgeOwner`. A tag a generator applies is a tag a user can apply too, so
  ownership is a claim made at creation, not a conclusion drawn from appearance
  — a user's hand-placed copy of the same rock survives a density change even
  when every property and the copied id match. It fails closed on a duplicated
  id (updating one leaves the other drifting) and on our owner tag without a
  usable id or group, and it never resets a property the desired set does not
  mention. The roadmap's four acceptance criteria are tests, not prose.
- `returnMode` on the five bulk write tools: `receipt` (default, unchanged),
  `failures` to drop the successful side entirely, and `full` to get the
  plugin's unedited row-per-input response back. Every compaction on the receipt
  path is lossless by construction, but "I believe it is lossless" is not the
  same as being able to look.
- `evals/room-benchmark/`, the roadmap's A3 fixture — one 8x8 room with fixed
  names, materials, colours, anchoring and seed, reached three ways: many
  `create_object`, one `mass_create_objects`, one `execute_luau`. Three of the
  seven categories in the measurement contract are deterministic given the
  routes, so `npm run evals:room-payload` computes and gates them with no model,
  key or Studio; the other four are named as absent rather than implied away.

  The deterministic half already contradicts the obvious reading. The batch
  route's **arguments are larger** than the per-part route's (5439 bytes against
  5398) — the same 28 parts have to be described either way — and its whole
  advantage is the response, 2932 bytes down to 69. Its schema is nearly double
  (1657 against 887), and schemas sit in the cached prefix where arguments do
  not, so the two trade a recurring cost against a per-call one. The `execute_luau`
  route is cheapest on the wire at 3204 bytes and gives up a declarative diff and
  a narrow capability for it.
- A `list_changed` probe: `docs/list-changed-probe.md`, an event journal behind
  `BLOXFORGE_LIST_CHANGED_PROBE`, `scripts/probe-report.mjs` and
  `scripts/probe-mark.mjs`. Lazy tool loading is only worth its complexity if the
  *model* can call a newly advertised tool, and "the client refreshed its list"
  is not evidence that it can — MCP requires no host to make new schemas
  available inside the turn already running, and at least one shipped a build
  whose UI updated immediately while the current agent turn stayed stale. So the
  criterion is not latency: a tool that did not exist when the turn started must
  be called successfully inside that turn, 29 times in 30, or the host gets a
  static profile and no `listChanged`. A host that scores 100% on refresh and 0%
  on the canary is the case the probe exists for, and the report prints both
  lines so it cannot read as a pass.

  No tool is added for it — an ordinary lazily-loaded tool is the canary, marked
  `newlyAdvertised` because it was absent from the previous generation's list.
  The journal writes nothing and changes no behaviour unless the variable names
  a file. Fewer than 30 repetitions is reported `INCONCLUSIVE` rather than as a
  percentage, since 29/30 is not reachable from ten runs.
- A frozen 784-case tool corpus under `evals/corpus/`, with `npm run
  evals:corpus-check` and `npm run evals:retrieval` in `release:check`. 218
  positive cases (one per tool), 436 nearest-neighbour confusers, 50
  no-tool/clarification, 50 multi-step and 30 stale-catalog/adversarial. It
  scores `searchCatalog` directly, so it needs no model, no provider key and no
  Studio — a benchmark that costs money to run gets run once, at the moment it
  flatters you.

  Two properties make the numbers mean something. Positive queries are written
  in task language and `corpus-check.ts` rejects any that reuses more than 75%
  of its own tool's vocabulary, because a corpus paraphrased out of the tool
  descriptions measures a lexical retriever against itself; the corpus sits at a
  mean overlap of 0.222. And the confusers are derived rather than invented —
  for each tool, its two nearest neighbours' own queries, asserting it does not
  outrank them — because a hand-written negative measures its author's intuition
  about the retriever rather than the retriever. Neighbours are measured with
  the retriever itself, as the sum of reciprocal ranks in both directions; a
  first draft used token-set Jaccard, which is symmetric and unweighted where
  `searchCatalog` is neither, and it picked non-competitors: the measured
  collision rate went from 3.4% to 26.4% once the derivation used the ranking
  actually under test.

  The first baseline says the retrieval layer is the weak one, and it is
  committed as-is so the fix has to prove itself: the gold tool reaches the
  8-item shortlist for **56.0%** of tools (95% CI 49.5–62.4) and ranks first for
  23.4%; "Make Workspace.Door transparent" does not surface `set_property` at
  all. A near neighbour takes first place on **26.4%** of confusers. A query with
  no tool answer is still offered a match **90%** of the time, because the
  ranking has no way to express "none of these" — the same shape as an audit that
  passes by not looking. That last number measures presence, not confidence:
  `searchCatalog` exposes no score to its caller, so nothing here can read one,
  and the eight stale-catalog cases are reported apart from the 22 retrieval
  ones for the same reason — no retrieval change can move them, so counting them
  together would pad the rate with cases the gate cannot fail on.

- `design_lint` now checks text contrast against WCAG 2.2 AA (4.5:1 for normal
  text) and reports the measured ratio with both hex colors, so a failing
  finding says what to change rather than only that something is wrong. The
  background is composited: it walks outward accumulating front-to-back "over"
  blending, because a semi-transparent veil over a dark panel is neither the
  veil's own color nor the panel's. Where a ratio cannot be computed honestly —
  a `UIGradient`, an image backdrop, a translucent `CanvasGroup` (which fades
  the text and its backdrop together, so the layer walk would otherwise report
  the ratio the group would have had at full opacity), or a stack that never
  reaches an opaque ancestor — the finding is `contrast_unknown` at info
  severity rather than a guess. Text that fails the ratio while carrying a
  stroke is `contrast_unknown` too, since an outline can rescue legibility and
  WCAG models none; a stroke on text that already passes raises nothing, because
  the outline sits at the glyph edge and cannot pull a passing ratio under the
  bar. The sRGB linearization uses WCAG 2.2's 0.04045 breakpoint, not the
  0.03928 of the pre-May-2021 text. The large-text
  exemption (3:1) is never applied automatically: `TextSize` is a line height,
  not the font's em size, so it cannot decide the WCAG 24px/18.66px threshold;
  a possibly-large case at or above 3:1 is reported at info severity instead.
- `scripts/check-endpoint-effects.mjs`, run in `protocol:check`, cross-checks
  every tool's declaration against the bridge endpoints its handler actually
  reaches, using `protocol-endpoints.json`'s own read/mutation classification.
  A tool that drives a mutating endpoint must declare a Studio write; one that
  reads must declare `studio.read`; an endpoint string in neither list is
  rejected outright. This is the sibling of `check-network-effects.mjs` and
  exists for the same reason: under-declaration is the failure invariant 1
  names, and the capability gate cannot see it. The call graph is class-aware —
  keying methods by bare name merged unrelated classes and produced 44 false
  findings, including the claim that `get_file_tree` reaches
  `/api/set-script-source`.
- `ToolDefinition.bridgeEndpoints`, an optional declaration of the non-read
  endpoints a tool drives, required only where the effects do not already imply
  them. Declared rather than derived, for the same reason `effects` is, and
  audited in both directions by the new check: a stale declaration fails as
  loudly as a missing one.

### Fixed

- The built-in design palette failed the rule `design_lint` now enforces.
  `onPrimary` on `primary` measured 4.32:1 in both themes — the exact pair the
  `button` recipe emits — so every button produced by `apply_theme` was below
  AA. Three tokens moved: `primary` to `rgb(66, 99, 235)` (4.98:1 under white),
  light `muted` to `rgb(92, 99, 106)` (was 3.15:1 on `bg`), and light `danger`
  to `rgb(201, 42, 42)` (was 4.28:1 on `bg`, passing only on `surface`). A test
  asserts every foreground/background pair the recipes actually use, so a future
  palette edit that reintroduces the failure breaks the build.
- The inspector advertised eleven tools it could never serve. `get_world_snapshot`,
  `scene_search`, `get_node_batch`, `get_spatial_layout`, `get_changes_since`,
  `design_lint`, `asset_fit_plan`, `asset_sanitize_plan`,
  `get_reproduction_bundle`, `get_device_simulator_state` and
  `get_simulation_state` compute a read-only answer by running server-generated
  Luau, so `studio.read` is an honest effect — but the transport is
  `/api/execute-luau`, and the inspector plugin refuses every endpoint outside
  the manifest's read set. Each call cost a round trip and came back "BloxForge
  Inspector is read-only and rejected endpoint", which reads to an agent as a
  broken server rather than a tool that was never available. The inspector's
  surface is 67 tools rather than 78, and the eleven are gone from it.
- Ten tools read from Studio without declaring `studio.read`.
  `capture_device_matrix` was the sharpest: it drives `/api/capture-screenshot`
  and returns pictures of the user's place while declaring only `studio.write`,
  so a client granted `write.instances` and deliberately not `read.scene` could
  take them. `set_script_source` read the existing source through
  `/api/get-script-source`, and the seven playtest and multiplayer-test tools
  returned runtime logs and playtest state. **This tightens the capability
  gate**: a client with an explicit capability allowlist now needs `read.scene`
  for these tools as well as the write or playtest capability it already had.
- `check-undo-coverage.mjs` kept its own copy of the signature parser, with the
  blind spot the shared one was just fixed for: it jumped to the next `{`, so
  `function handler(...): { ok: boolean } {` reads as a body of `{ ok: boolean }`
  and a handler that does record an undo waypoint reports as one that does not.
  No handler triggers it today — that direction only ever loses statements, so
  it fails closed — but the natural response to a false "mutates without a
  recording" is to write an excuse into `NO_RECORDING`, which then outlives the
  real recording it was covering for. The copy is gone; the check now imports
  `functionBody` from `scripts/lib/tool-source.mjs`, and `tests/tool-source-parser.mjs`
  holds that parser to every shape that has defeated it. Stale `NO_RECORDING`
  entries are rejected too: nothing walked that list, so an exception whose
  endpoint had been renamed or reclassified sat there reading like policy.
- The shared parser resolved a repeated function name to whichever declaration
  came first in the file. `QueryHandlers.ts` declares `searchRecursive` three
  times, each nested in a different handler, so a lookup returned a body
  belonging to a different function — confidently, with nothing to say it had
  guessed. A unique top-level declaration now wins over nested ones, and an
  otherwise ambiguous name resolves to nothing at all. It also counted `if (…)`
  and `for (…)` at member indentation as methods named `if` and `for`: no caller
  looks a method up by those names, so no verdict was ever wrong, but the counts
  the checks print were. None of the three audits changes its result.
- The signature parser behind the effect audits treated a return type
  annotation as the method body, so `private async _captureFingerprint(...):
  Promise<{ fp: Fingerprint; ... }>` reported the object type as the whole
  method and everything it actually called was invisible. `get_changes_since`
  passed the endpoint audit by never being examined, and the network audit had
  the same blind spot. Both now read whole bodies.

## [4.3.1] - 2026-08-08

### Added

- `npm run protocol:compat-check` fails the build if an SDK bump makes a
  forbidding MCP revision negotiable. It runs in the main CI job and in
  `release:check`, deliberately not in `protocol:check`: it reads the installed
  SDK, and the plugin job that runs `protocol:check` installs only
  `studio-plugin`'s dependencies, never the root ones — every other script there
  is dependency-free by design. From revision
  2026-07-28 the tool set "MUST NOT vary per-connection or as a side effect of
  other requests on the connection" — both of which `load_toolset` does. Every
  revision the pinned SDK can negotiate (2025-11-25 and earlier) permits it, so
  4.3.0 is compliant with everything it can actually speak; the risk is that
  upgrading `@modelcontextprotocol/sdk` would turn that into a silent MUST NOT
  violation with no test failing and no code changing. Verified against the
  specification, not inferred. Resolving it when it fires means gating the
  dynamic path on the negotiated version — static profile and no `listChanged`
  under a forbidding revision — not deleting the check.

### Changed

- `check-network-effects` gained two kinds of reach it never had. It now
  recognizes a bare `fetch(` as a network client and propagates through
  `this.x()` calls to a fixed point; and it fails when a network-reaching method
  is the target of no tool's dispatch entry at all. Both close the same hole
  from different sides. `importExternalAsset`, `importRbxm` and the
  `universeIdForPlace` helper call `fetch` directly rather than through a client
  module, so the audit reported "12 network-reaching tools" while two of the
  tools that most plainly reach the network went unexamined — coverage is now
  14. Separately, five of the 218 tools (`rojo_serve_status`, `_logs`, `_stop`,
  `rojo_resolve_instance_source`, `_source_instance`) are generated by `.map()`
  with template-literal names, which neither regex can see, and a tool the check
  cannot enumerate cannot fail it. Every effect involved was already declared
  correctly, so nothing shipped wrong; what was wrong is that the check
  under-counted its own reach, which is the failure it exists to prevent.
- `load_toolset` now tells callers to switch toolsets at phase boundaries rather
  than per call, in the tool description, both `client_hint`s, the README and the
  architecture doc. The `client_hint` caveat is appended to every response where
  the tool set actually changed — load-only, unload-only and mixed — because it
  is a property of the set having moved, not of the direction it moved in; a
  first draft carried it only on the unload-only branch, so the common call told
  the caller nothing. Tool definitions sit at the top of the prompt-cache hierarchy
  — above system and messages — so changing them invalidates the cached prefix
  for the entire conversation, not only the schemas that moved. 4.3.0 shipped the
  `unload` guidance without that caveat, which made frequent releasing look free
  when it can cost more than the schemas it frees.

### Removed

- The `ROADMAP-RESEARCH-*` documents are no longer tracked, and `ROADMAP-*` is
  ignored. They are working notes for a research pass, not product
  documentation, and every one of them went stale the moment its findings were
  implemented — leaving a repo file that contradicted the code it described.

### Fixed

- A `CFrame` no longer loses its orientation on the way out. Three separate read
  paths reduced it to a position and reported success:
  `mass_get_property` / `get_attributes` answered
  `{"_type":"CFrame","Position":{...}}`, `get_node_batch` answered three numbers
  byte-identical to the `Position` field, and the change fingerprint behind
  `get_changes_since` hashed only `cf.Position`. Verified live: rotating a part
  from Orientation `[20.7,49.1,82.2]` to `[0,90,0]` with its position untouched
  produced `"changed":[]` and `changedCount: 0` — a visible edit the changefeed
  could not see at all. Reads now carry the orientation (`mass_get_property`
  adds exact `Components` plus `Orientation` in degrees; `get_node_batch`
  returns six numbers), and the fingerprint folds rotation into its geometry
  signature. Of every type this serializer handles, `CFrame` was the only one
  that looked like a complete structured read while half the value was gone —
  an `unsupported` marker at least admits the loss.
- A serialized `CFrame` can be written back. Neither the attribute path
  (`deserializeValue`) nor the property path (`convertPropertyValue`) had a
  `CFrame` branch, so the tagged table fell through and was stored as a table.
  Both now rebuild it through a shared `cframeFromTable`, preferring the exact
  `Components` and accepting hand-written `Position` + `Orientation`.

## [4.3.0] - 2026-08-08

### Added

- `load_toolset` gained `unload`, so a domain can be released once a session is
  done with it. Loading was one-way: the advertised tool list is re-sent on
  every request, so a session that ran one playtest carried the runtime
  domain's ~13.2k tokens of schemas on every later turn whether or not it
  played again. `unload` may be sent on its own (`{"unload":["runtime"]}`), and
  core is never released — dropping it would strand a session with no way to
  search for or load anything back. Both transports honour it: the stdio server
  deactivates and re-sends `tools/list_changed`, and the stateless HTTP
  transport shrinks the next `tools/list`. Unload is applied before load, so
  naming a domain in both means "loaded" on either transport rather than
  depending on which loop ran last.
- `tool_catalog_search` and `load_toolset` now report `approxTokens`, the
  recurring per-request cost of each domain, so the agent can see what a load
  costs before paying for it and which one is worth releasing. Measured against
  the real definitions: 218 tools cost ~49.9k tokens if all advertised, the
  always-on core set costs ~4.8k, and `runtime` alone is ~13.2k.
- `npm run tools:token-report` prints the per-domain and per-tool token cost of
  the advertised schemas, and `--check` fails when the always-on core set
  exceeds its 6000-token budget. Added to `release:check` and CI. Adding a tool
  to `CORE_TOOLS` taxes every request of every session, including the ones that
  never call it, so that number is a budget and not a statistic. Until now
  nothing in the repository measured this, which made every claim about token
  efficiency here an opinion.

### Fixed

- The stdio server changed the advertised tool list even when `load_toolset`
  failed. It applied the transition whenever the tool returned, without checking
  `isError`, so a partly-valid request — `{"toolsets":["scene",123]}`, which
  throws on the number after `scene` has already been accepted as a selector —
  answered "error" and expanded the list anyway, leaving the client's view of
  the tool surface and the server's disagreeing with nothing to explain the gap.
  The Streamable HTTP path has guarded on `isError` since it was written; both
  stdio branches now match it, and the legacy branch shapes its result before
  deciding rather than after.

### Changed

- `get_changes_since` no longer advances the baseline as a side effect of being
  read. A `snapshotId` silently meant "since my previous call" rather than
  "since the baseline", so asking the same question twice reported an unchanged
  world, and an agent had no way to ask what it had built over a session — the
  one question the snapshot id looks like it answers. The baseline now holds
  still. Pass `rebaseline: true` for the old polling behaviour, where advancing
  it is the point; the response's new `since` field (`baseline` or
  `previous-call`) says which question was answered, and `baselineAt` says as of
  when, so a quiet world is distinguishable from a baseline that just moved.
  This also fixes the `roblox://world/changes` resource, where a re-fetch used
  to consume the changes and return an empty diff with nothing to explain why —
  a resource read is a read.

### Security

- Two tools sent data off the machine while declaring they did not, which put
  them on the wrong side of the capability gate. `design_review` screenshots the
  user's place and uploads it to Pollinations (`gen.pollinations.ai`) for a
  vision critique; `get_roblox_docs` fetches from `create.roblox.com`. Both
  declared only `studio.read`, which `requiredCapabilities` maps to
  `read.scene` — so a client granted nothing but the narrowest read capability
  could still cause a picture of the user's place to be uploaded to a third
  party. This is invariant 1's under-declaration case, the one it names as the
  worse failure. Both now declare `network.external`, which maps to
  `assets.external` — the capability a local-only user withholds. Sibling tools
  on the same client (`image_generate`, `image_generate_and_upload`) already
  declared it, so this was an omission rather than a decision.
  `design_review`'s description now says the screenshot leaves the machine, and
  `protocol:check` gained `check-network-effects.mjs`, which maps every tool to
  the facade method its handler calls and fails when that method reaches a
  network client without the effect. It reads effects from source rather than
  `packages/core/dist`, because it runs before any build.
- The generated tools reference labelled every tool by category alone, so
  `design_review` — which uploads a screenshot — was published as `(Read-only)`.
  Category describes what a tool does to Studio and says nothing about whether
  the call leaves the machine, which is the distinction a local-first user is
  deciding on. All 26 tools declaring `network.external` are now marked
  `· sends data off this machine` in their heading.
- Three vulnerable packages shipped in the published CLI's dependency tree, all
  reached through `@modelcontextprotocol/sdk@1.30.0`: `ip-address` ≤ 10.3.0
  (three advisories, each an SSRF or trust-boundary bypass — leading-zero octets
  decoded as decimal where resolvers decode octal, a CIDR suffix suppressing
  special-use classification, and misclassified IPv4-mapped/NAT64 addresses),
  `fast-uri` 3.0.0–3.1.4 (host confusion via a backslash authority introducer),
  and `hono` ≤ 4.12.33 (ReDoS in CORS middleware, `memo()` retaining SSR output
  across requests, Proxy Helper leaking headers named in `Connection`, and
  algorithmic-complexity DoS in language middleware). Two rated high.
  These were not dev-only: `npm audit --omit=dev` reported them, and all three
  resolve under `@princeofscale/bloxforge`'s own dependencies, so anyone who
  installed the CLI got them. The SDK was already at its latest release, and
  every fix fits inside the existing semver ranges, so this is a lockfile
  update — no declared dependency changed.

## [4.2.0] - 2026-08-07

### Added

- `get_spatial_layout` — where things physically are. Every other scene read
  answers a question about the tree: what classes exist, what is named what,
  which script owns the day/night cycle. None of them answer the one an agent has
  to settle before it places a single part — how big the built area is, where the
  ground is, and which patch of it is empty. Names and classes cannot tell you a
  new building would land inside an existing one. Returns the bounding volume,
  the ground plane and the `y` to stand things on, the largest children with
  position and size, SpawnLocations, and a coarse occupancy grid over the XZ
  plane: `.` empty, `1`-`9` that many parts, `#` ten or more, north first. The
  grid is the point — a few hundred characters that say where the free space is,
  instead of thousands of stud coordinates the caller would have to intersect
  itself. Part bounds are expanded onto the world axes, so a rotated beam reads
  as the eighty studs it occupies rather than the four its `Size` names, and
  baseplate-sized parts are excluded from the grid so it does not come back
  uniformly full. Grid resolution and landmark count are clamped, so no argument
  turns this into a wall of text.
  Reads a part's position through `CFrame.Position` rather than `.Position`:
  the same value, and the one a non-Studio Luau host can read, which is what
  makes the runtime test above possible.
- `asset_fit_plan` / `asset_fit_apply` — measures how a model sits in the scene
  and corrects it. A model from the marketplace, a Package or an `.rbxm` arrives
  at whatever scale its author worked in, with its pivot wherever their modelling
  tool left it — often the world origin, which makes every later move and rotate
  swing it around a point far outside the model. Neither is visible to an agent
  that can only read names and classes. The plan reports the model's height
  against a Roblox character (about 5 studs, the one absolute reference the
  platform gives you), where the pivot sits inside the bounding box, and how many
  parts are unanchored and would fall on the next playtest. The scale it proposes
  is absolute against the authored size rather than a factor, so applying it to
  an already-scaled model does not compound. The apply requires the plan's
  `planHash`, which covers the current size, pivot, requested height and pivot
  policy, and re-measures immediately before changing anything. A non-Model is
  refused with the reason — scale and pivot are Model properties.

- `asset_sanitize_plan` / `asset_sanitize_apply` — reads what the scripts inside a
  model actually do, for a model that is already in the scene. `asset_preflight_insert`
  answers "can I insert asset 123, and does it carry scripts" before anything is
  parented, and it counts them without reading them; it cannot help once a model
  has arrived from a Package, an `.rbxm`, a collaborator, or an insert nobody
  preflighted. The plan flags capabilities that matter in code you did not write —
  loading another asset at runtime, network access, `loadstring`, `getfenv`,
  purchase prompts, kicks, DataStore and TeleportService use, runtime remote
  creation — and grades the model. Script source is never returned, only the
  matched capabilities and sizes, so a 40-script model does not cost more to
  report than to read; a clean script contributes its count and nothing else.
  The apply disables or removes every script in the subtree as one undo waypoint
  and requires the plan's `planHash`, which covers each script's content: a
  script added or edited in between invalidates the plan rather than riding
  along. The hash also covers the action, so a `remove` cannot be applied against
  a `disable` plan. `disable` refuses a ModuleScript, which has no `Enabled`,
  rather than reporting success and leaving it live, and `remove` unparents
  instead of destroying so the change stays undoable.

- Upstream-derived regression scenarios in `tests/studio-tooling-smoke.mjs`,
  taken from the issue tracker of the project BloxForge descends from: an MCP
  write clobbering a script open with unsaved changes, a playtest whose peers
  never go away, a Play Solo screenshot sourced from the edit DataModel, and
  temporary bridge objects left in the tree after a stop. None reproduced when
  run by hand against a live Studio — which is the reason to keep them, since
  "we already handle that" decays silently without a test.

### Changed

- The argument guards on every mutating tool are now exercised, not just
  spell-checked. `check-argument-errors.mjs` proved the refusals name a
  parameter rather than describing the problem in prose, but nothing proved a
  guard actually fired — and in this repo a guard's condition has been broken
  while its message stayed perfectly correct. Twenty-one guards now run against
  a bridge that throws on contact, so one that stopped firing reaches the bridge
  and fails with a different error than the one asserted. Confirmed by breaking
  a condition on purpose and watching the suite go red. `mutation-tools.ts`
  coverage moved from 33% to 63%.

- The Luau this server generates now runs under Lune against a real DataModel,
  in `release:check` and in CI. Generated Luau is where the read tools actually
  compute their answers, and none of it was reachable from Jest — it could only
  be checked by hand against a live Studio, which in practice means checked once
  and then never again. Lune supplies real `CFrame`, `Vector3` and Instance
  semantics, so `get_spatial_layout`, `get_node_batch`, `scene_search`, the
  `get_changes_since` fingerprint and the `asset_fit_plan` scan are now asserted
  on: a rotated 4x4x80 beam has to read as the eighty studs of X it occupies, a
  baseplate has to be excluded from the occupancy grid rather than fill it, a
  390x300x2 wall must not be mistaken for the ground it stands on, a batch row
  for a missing path must report itself rather than vanish and leave the caller
  matching answers to requests by position, and an unresolvable fit scan must
  fail closed. The builders are called and their output is what runs, so the
  tests cannot drift from them by copying. `get_world_snapshot` and the sanitize
  scan cannot run there — Lune reads properties from rbx-dom, which has no value
  for one that was never assigned and has no default, so `game.PlaceId` and
  `Script.Enabled` are unreadable. That is a limit of the host, not a defect in
  those builders.
- `release:check` now runs the 10,000-request fault-injection benchmark, and the
  `release:check:full` alias is gone. The benchmark lived only in the alias, so a
  green `release:check` could still fail CI's Node 20 job — which is how a bridge
  registration regression reached CI instead of being caught locally. The
  benchmark takes well under a second; `release:check` exists to predict CI, so
  anything CI gates on belongs in it.

### Fixed

- `sync-tools.ts` was invisible to `grep`. Its plan-hash canonicalization joined
  each pair of fields with a raw NUL byte — a sound choice of separator, since
  NUL cannot occur in a path, a class name or a hex hash — but a NUL anywhere in
  a file makes `grep` classify it as binary and print `Binary file … matches`
  instead of the matching lines. Under a wrapper that swallows that notice, every
  search in the file returns nothing at all, which reads as "no such code" rather
  than "not searched": while auditing invariant 2 this made a plan-hash guard
  that is present (`sync-tools.ts:409`, `requirePlanHash`) look absent. The
  separator is now written as the escape `\0`, which a template literal evaluates
  to the same byte, so every plan hash is unchanged. `protocol:check` now fails on
  a raw NUL byte under `packages/core/src/tools`.
- The batch mutation tools accepted a string where an array belongs, and one of
  them then lied about it. `inputSchema` is advertised to clients but never
  enforced server-side — neither `server.ts` nor the tool pipeline validates
  arguments — so a declared `string[]` is erased at the JSON boundary. A caller
  sending `paths: "game.ServerScriptService"` cleared a bare `.length === 0`
  check against the *string's* length: `mass_set_property`, `mass_get_property`
  and `mass_duplicate` forwarded the string to the bridge, and
  `mass_create_objects` told the safety gate "create 24 objects" and wrote
  "created 24 objects" into the operation history for a batch that never
  existed — 24 being the length of the string. (`mass_delete_objects` escaped
  only by accident, on `paths.find is not a function`.) All five now check
  `Array.isArray`, which is what `bulk_mutate` in the same file and
  `load_toolset` already did.
- `mass_get_property` reported success while returning no value. The response
  encoder drops any key holding userdata, so a handler that returned the property
  verbatim answered `{path, success: true, propertyName}` with `propertyValue`
  simply absent — indistinguishable from a successful read at the call site.
  Verified against a live place: `Anchored` came back as `true`, while `Color` and
  `Material` came back as successes with nothing in them. `Size`, `Position`,
  `CFrame` and `BrickColor` lost the same way, which is most of what a caller
  batch-reads while building. Values are now tagged (`{R,G,B,_type:"Color3"}`,
  `{Name,Value,EnumType,_type:"EnumItem"}`) and primitives still pass through as
  primitives, so a boolean does not become `"true"`.
  The serializer moved to `Utils` because `get_attributes` had the same hole for
  every attribute type past Vector3/Color3/UDim2/BrickColor — it kept reporting
  `type`, so only the value went missing — and both readers now route through one
  implementation that also covers Vector2, UDim, NumberRange, Rect and Instance.
  A type it still cannot represent comes back as an explicit
  `_type: "unsupported"` marker rather than vanishing, and `set_attribute` refuses
  such a marker instead of storing the text where a NumberSequence belongs.
- Batch create and duplicate summaries hid rejected properties. A row carrying
  `propertyErrors` is counted a success, correctly — the instance does exist — but
  that put `{succeeded: 4, failed: 0}` next to two properties the engine had
  refused, and nothing in the summary suggested opening the rows. Observed live on
  a `mass_create_objects` batch. `mass_create_objects`, `smart_duplicate` and
  `mass_duplicate` summaries now carry `withPropertyErrors`.
- `propose_next_action` sent agents to fix a script that does not exist. It pulls
  dotted names out of error text to name the script to open, and a URL host is a
  dotted name too — so an episode whose errors were all asset fetches
  (`MeshContentProvider failed to process https://assetdelivery.roblox.com/…`)
  came back as `action: "fix_script"`, `focus: ["assetdelivery.roblox.com"]`,
  "Open the implicated script(s), fix the error, then re-run". Observed on a live
  episode where all 23 errors were content fetches and every assertion passed:
  the self-driving loop had no exit. URLs are now stripped before the scan, and
  when nothing names a script the rationale says so and points at `logs.errors`
  instead of naming a file to open. The verdict still fails — an episode whose
  assets did not load did not go well, and telling those apart from a genuinely
  broken asset id would be guesswork.
- `execute_luau` could not produce a Studio Undo waypoint. The plugin has always
  opened a `ChangeHistoryService` recording for any script that arrives with an
  `undoLabel`, but only the generated builders were sending one — the parameter
  was never exposed on the tool, and the server dropped it. So an agent writing
  its own mutation through the most general write path there is landed the edit
  outside the undo stack, and Ctrl+Z would not take it back. `undoLabel` is now
  an optional parameter of `execute_luau`: pass it whenever the code changes the
  DataModel, omit it for reads, since an empty recording is worse than none. A
  script that errors still cancels its recording rather than leaving a waypoint
  the user has to undo separately.
- `execute_luau_async`'s description recommended it over `execute_luau` for
  "mass builds" without saying that a job's changes are not undoable. A recording
  cannot span an asynchronous job's yields without blocking the user's own edits,
  so that is a real property of the tool and now stated where the caller reads,
  along with the advice to keep async for long reads and scans.

- `docs/architecture.md` claimed 213 tools; there are 218. It went stale inside
  the very branch that last corrected it, because adding a tool does not touch
  the file that states how many exist. `docs:check` now compares that number
  against `TOOL_DEFINITIONS` and fails when they disagree, so the next person to
  add a tool is told rather than trusted to remember. The ASCII diagram around it
  had also come apart — rows were 52 to 61 characters wide inside a 59-character
  frame, most likely since the rename to BloxForge — and is square again.

- `capture_screenshot`'s description still promised "the returned image is never
  downscaled" after the default downscale landed, so the one place a caller reads
  about the behaviour contradicted it.
- `README.md` described a Wally safety guarantee the code does not implement. It
  said a locked install is "refused" when `--locked` is absent from the released
  Wally 0.3.2; the code runs the install and protects the lockfile by backing it
  up and restoring it if the install moved it, which is what `docs/architecture.md`
  already said. The two documents contradicted each other on a safety claim, and
  the README was the wrong one.
- `docs/architecture.md` said "130+ tools"; there are 213.
- The changelog quoted a coverage ratchet (60.77 / 50.57 / 53.68 / 62.41) that
  `jest.config.js` no longer holds.

### Security

- Eleven caller-supplied values across seven tools reached generated Luau without
  being escaped, so a crafted argument executed arbitrary code in the Studio
  plugin's edit context. `apply_theme` and `design_lint` were caught by the same
  audit through `minTextSize`, and `radiusMd` was wrapped in the same pass. The
  full set:
  `template_create_simulator_game`'s `currencyName` (interpolated inside a Luau
  string literal, so a quote closed it), and the numeric arguments of
  `template_create_tycoon_game`, `template_create_round_game`,
  `template_create_obby_game` and `environment_create_day_night_cycle_script`
  (typed `number` but never checked at runtime, so a JSON string was emitted as
  code). `environment_create_day_night_cycle_script` also placed the caller's
  `scriptName` inside the `[==[ ... ]==]` literal holding the generated script's
  Source, where a name containing that literal's closing delimiter ended it early
  and turned the remainder into executable Luau.

  This mattered because none of these tools declares the `studio.execute` effect.
  That effect is what the `builder` profile filters on — the profile README
  describes as "arbitrary Luau execution denied" — and what the `execute_luau`
  safety gate hangs off, so both were bypassed by tools that promise neither.

  Every value now goes through `luaString`/`luaNumber`, and the script name is no
  longer interpolated into the Source literal at all; it is still applied to the
  Instance through `luaString` where it belongs. Regression tests drive each
  builder with a string that closes its quote, a name that closes the long
  bracket, and a "number" that was never a number — and the detector is itself
  tested, because a marker that vanishes with the literals it hides in proves
  nothing.

## [4.1.0] - 2026-08-05

### Added
- `mass_delete_objects` — the bulk counterpart to `mass_create_objects`, and the
  one CRUD verb that had no bulk form (create, duplicate, get and set all did).
  The whole batch is a single Studio undo step, so one Ctrl+Z puts it all back,
  and missing paths are reported per-path rather than failing the batch. It is
  wired to the safety manager's `bulk_delete` kind, which had been implemented —
  protected-path check plus count gating — but never connected to any tool.
  Because `assess()` takes one path, the tool surfaces a protected path from
  anywhere in the batch, so a list ending in `ServerScriptService` cannot slip
  the gate.

- Asset Manifest v1 — `bloxforge.assets.json`, plus `asset_manifest_status` and
  `asset_manifest_plan`. An asset in a place is an opaque numeric ID, so nothing
  recorded which local file produced it, with which import settings, or which
  version is published; "rebuild this on another machine" was guesswork. The
  manifest declares that identity per logical asset and the tools report
  desired-versus-actual: source present, source hash still matching what was
  published, import recipe, Roblox assetId/version, and any declared material
  map that is missing or over the declared texture budget.
  `asset_manifest_plan` returns an immutable `planHash` covering the manifest
  and the current content of every file it references, so swapping a texture
  between preview and apply invalidates the preview — the same contract as Rojo
  syncback rather than a second, weaker one. Unknown keys are rejected (a
  silently ignored `pivotPolicty` would import with the wrong pivot), a damaged
  manifest is an error rather than an empty one, and a missing source file is
  reported as blocking rather than as a no-op. Both tools are local and offline;
  publish/import remain the existing Studio and Open Cloud paths.
- `asset_manifest_scan` proposes manifest entries from what is already on disk,
  because hand-writing one entry per asset is what stops a manifest from being
  adopted. It walks an art directory for `.glb`/`.gltf`/`.fbx`/`.obj` sources and
  binds sibling textures to Color/Normal/Roughness/Metalness by filename suffix
  (`_color`, `_basecolor`, `_albedo`, `_normal`, `_roughness`, `_metalness`, …),
  longest suffix first so `_basecolor` is not read as `_color`. It distinguishes
  a texture named after the source whose suffix it does not recognise (reported
  under that asset) from one belonging to no scanned source at all (reported
  once for the scan) — listing the latter under every asset would read as though
  every asset had stray maps. It also reports manifest entries whose source has
  disappeared. Read-only: it proposes, it never writes the manifest.
- A coverage ratchet. CI runs the suite with `--coverage` and fails if statement,
  branch, function or line coverage drops below what the suite reaches today
  (61.58 / 51.33 / 54.46 / 63.25 measured, held at 61 / 51 / 54 / 62.8). It is deliberately a
  floor rather than a target: an aspirational percentage would have to be
  switched off to merge anything, whereas "coverage may not fall" is enforceable
  from the first commit.
- Generated-Luau mutations are undoable in one step. `execute_luau` carries
  every recipe, terrain, lighting, UI and mutation-plan write, and it opened no
  `ChangeHistoryService` recording at all — so none of those tools produced an
  Undo waypoint, and `_runGeneratedLuau`'s own comment claiming "the safety
  layer, history, and instance routing all apply uniformly" was wrong about
  history. The request now carries an optional `undoLabel`; when present the
  plugin wraps the script in one recording and commits it only if the script
  succeeded, cancelling otherwise so a half-finished script leaves no waypoint.
  The label is opt-in rather than inferred from the endpoint, because the same
  endpoint serves reads (world snapshot, fingerprint, syntax check) that must
  not open an empty recording, and runtime peers that have no edit history at
  all. A dry-run mutation plan stays unlabelled; only the apply records.
- `scripts/check-undo-coverage.mjs`, wired into `protocol:check`, holds that
  line: every endpoint declared a mutation must open a recording or appear in an
  explicit exception list with its reason. 26 of 41 record; the 15 exceptions
  are undo/redo themselves, session and playtest control, runtime input, the
  debugger, and async jobs — a recording cannot safely span a spawned job's
  yields, which is marked as a known ceiling rather than left implicit.
- The bridge fails closed on a plugin whose protocol is older than the minimum
  it can serve. `MIN_SUPPORTED_PLUGIN_PROTOCOL_VERSION` is 3, the version that
  introduced the stale-response fence (server epoch, plugin session binding,
  delivery attempt, lease token). Below it, `/ack` and `/response` fell through
  to the unfenced path, so the server could accept a result it had no way to
  prove belonged to the request it was answering — a silent downgrade of the
  delivery guarantee that only surfaced as a console warning. `/ready` now
  answers `426 Upgrade Required` with `serverProtocolVersion`,
  `minimumProtocolVersion` and the `--install-plugin` command, and refuses
  before creating any registration state, so no half-registered instance is
  left behind. A plugin that omits `protocolVersion` entirely is refused rather
  than assumed current. The plugin shows a persistent banner for 426 instead of
  retrying: unlike the 409 stale-registration case, retrying can never clear it,
  and the previous behaviour was a bare `warn` and a silently dead connection.
  A protocol *newer* than the server's is still only a warning, as before.
- `docs:check` now also resolves every relative Markdown link in the tracked
  docs. `CONTRIBUTING.md` pointed at a `todo.md` that had never existed and CI
  never noticed, because the check only compared the generated tool reference.

### Changed
- `capture_screenshot` returns the image downscaled to 1568px wide by default,
  with a new `maxWidth` parameter and `maxWidth: 0` for the native capture. A
  Retina Studio window captures 3130x1760 for a 1365x768 logical viewport — 5.2x
  the pixels, carried across the bridge as raw RGBA and paid for by the model,
  for content that renders at logical resolution. Vision models resize past
  roughly 1568px anyway, so those pixels were transferred and then discarded;
  measured live, the default capture went from 918KB to 326KB. The reported
  size and the `simulate_mouse_input` coordinate conversion always describe the
  image actually sent, so click coordinates stay correct at any `maxWidth`.
- `structuredContent` is attached only to tools that declare an `outputSchema`.
  It is a byte-for-byte copy of the text block, so attaching it to every tool
  charged each response for its payload twice — 45% of the bytes measured over a
  live session — and 157 of 213 tools declare no `outputSchema`, leaving a
  client nothing to validate the copy against, which is the only thing
  `structuredContent` is for. The MCP specification's compatibility guidance
  runs the other way: a server returning structured content should also send the
  serialized JSON as text, and that text is what every response already carries.
  Tools that declare an `outputSchema` must return conforming
  `structuredContent` and continue to. The text channel is unchanged for every
  tool, so a client reading `content` sees exactly what it saw before.

### Fixed
- `get_file_tree` no longer spends almost its whole response on things nobody
  authors. Read against a live place holding 24 parts, the whole-DataModel walk
  returned 326KB — roughly 90,000 tokens — in which `Stats`, `StylingService`,
  `MemStorageService`, `CoreGui`, `PluginGuiService` and
  `VisualizationModeService` were 2,246 of 2,345 nodes, and another 107 services
  were present but empty. The same read is now 10KB and 99 nodes. Both filters
  apply only to the DataModel's own children and only when the caller named no
  root, so `get_file_tree` on `game.CoreGui` is unchanged, `include_internal`
  restores the full walk, and the response reports how many services it left
  out rather than omitting them silently. A denylist rather than an allowlist of
  authorable services: if Roblox ships a new noisy service the cost is a larger
  response, never hidden user content.
- `load_toolset` actually expands the advertised tool list over the Streamable
  HTTP transport. `applyToolset` — the only caller of `registry.activate` —
  lives on the stdio server, so over `/mcp` the tool answered `loaded: ["scene"],
  count: 74`, the very next `tools/list` still returned the 29 core tools, and
  the response's `client_hint` blamed the host's schema-refresh step for
  something the server had never done. The tools stayed callable blind
  throughout, so nothing failed loudly.
- `load_toolset` and `tool_catalog_search` reject a malformed request instead of
  answering one. `{"toolset":"scene"}` and `{"toolsets":"scene"}` both coerced to
  an empty selector list and returned a success shape whose `client_hint`
  pointed at the host; `tool_catalog_search` with no `query` scored the catalog
  against an empty string and returned the first eight tools as if they were
  matches. Both parameters are declared required, and `toolsets` now also
  declares `minItems: 1`.
- The `ui_create_*` argument error named a tool that does not exist. The name
  was derived with `className.toLowerCase()`, so `TextLabel` produced
  `ui_create_textlabel` rather than `ui_create_text_label` — the one message
  pointing an agent at its mistake sent it looking for the wrong tool. Only
  `ui_create_frame` was correct, being a single word. `scripts/check-argument-errors.mjs`
  now runs in `protocol:check` and fails the build when an argument error
  describes a parameter instead of naming it.
- Argument errors in the mutation, scene-read, runtime and asset tools name the
  schema parameter instead of describing it. `mass_get_property` answered "Paths
  array and property name are required", leaving an agent to guess that those
  are `paths` and `propertyName` — a wasted round trip per miss, and the same
  defect already fixed for the script tools. Twenty-two messages across five
  files now name the parameter; each name was checked against the tool's
  declared `required` list rather than assumed.
- Error classification recognises "requires" as well as "required", so a handler
  writing `get_roblox_docs requires a name` is reported as `INVALID_ARGUMENT`
  with a recovery hint rather than falling through to `UNKNOWN`. The
  confirmation and beta-feature rules are more specific and still take
  precedence.
- `CONTRIBUTING.md` states the PR gate contributors are actually held to
  (`lint`, `typecheck`, `test`, `build:all`, `docs:check`) and points at
  `release:check` for releases. It had asked for `typecheck && test && build`,
  a strictly weaker set than CI runs, so a contributor following it could pass
  locally and fail on lint or a stale generated tool reference.
- The comment above `interpretInsertResponse` named `InsertService:LoadAsset`.
  The plugin has moved to `AssetService:LoadAssetAsync`; the AUTH classification
  it explains is unchanged, but the comment sent readers to the wrong API.
- Argument errors in the script tools name the parameters instead of describing
  them. `edit_script_lines` is the worst case: the name promises a line range,
  the tool is a string replace, and the natural first call —
  `startLine`/`endLine`/`newText` — came back with "Instance path, old_string,
  and new_string are required" without saying what to send instead. It now
  states that the tool replaces exact text, that `startLine` only anchors an
  ambiguous match, and which sibling tools do work by line number. The same
  correction went into its description, where the name is read first.
- `load_toolset` no longer reports a toolset it does not have. `loaded` echoed the
  request back verbatim, so asking for `"scripting"` (the domain is `"scripts"`)
  answered with success and no script tools — and `client_hint`'s
  schema-refresh caveat read as the explanation, sending the caller to restart
  their client over a one-word typo. Unrecognized selectors now come back under
  `unknownToolsets` with `validToolsets`, and the hint names the miss.
- Seven "Instance path is required" errors now say `instancePath`, the actual
  parameter name. The message described the argument in prose while neighbouring
  tools take `path` or `paths`, so it confirmed something was missing without
  saying what to write.
- `run_gameplay_assertions` works against a running playtest. It compiled each
  `expr` with `loadstring`, which is fine in the plugin's edit context but throws
  `loadstring() is not available` on a *runtime* peer, because
  `ServerScriptService.LoadStringEnabled` is off by default. So `target: "server"`
  — the pairing this tool's own description recommends, and the only one that can
  see live state — evaluated nothing on a default place. The expressions are now
  emitted inline into the chunk being sent, which reaches the runtime peer through
  the plugin's existing ModuleScript fallback. Verified live: 0/3 with
  `"error":"loadstring() is not available"` before, 3/3 after.
- A batch that never ran no longer reports every assertion as failed.
  `run_gameplay_assertions` returns `evaluated: false` with the underlying error,
  and re-runs the assertions one at a time to name the expression that broke the
  batch. `run_playtest_episode` grades that as `verdict: "error"` rather than
  `"fail"` — the game may be perfectly healthy and the harness simply unable to
  look at it, and sending an agent to fix three working things is the worse
  outcome.
- `validate_script_source` compile-checks through the connected Studio, so it works
  without any optional binaries installed. It shelled out to luau-analyze, Selene
  and StyLua only — on a machine with none of them it answered with three "is not
  installed" lines and nothing else, which meant a typo could only be found by
  writing the script into the place and burning a playtest cycle on it. The plugin
  context has `loadstring`, which parses without executing and returns the Luau
  parser's own message, so the authoritative checker for the target runtime was
  available the whole time. Results arrive under `syntax` with the blamed line, the
  chunk-name noise stripped; the CLI checks still run when present.
- `scene_search` no longer scores single-character tokens. `"BF_M"` split into
  `bf` and `m`, and the one-character `m` matched `Camera` alongside the parts
  actually wanted — ranking buried it on a small place, but on a real one a stray
  letter drags in enough chaff to eat the result limit before the real hits are
  reached. Dropped only when a longer term survives, so a deliberate one-character
  search still works. Tokenizing moved out of the emitted Luau into
  `sceneSearchTerms`, where it is directly testable.
- `run_playtest_episode` actually reads the run's logs. It passed `startedAt` — a
  millisecond epoch — as `since`, but `since` is a *sequence cursor*: the plugin
  filters `entry.seq > since`, and `seq > 1.78e12` is never true for a seq that
  starts at 1. The episode collected **zero entries, always**, so `errorCount` and
  `warningCount` were structurally 0 and no runtime error could reach the verdict.
  This sat underneath the log-severity bug: fixing the classifier could not help
  while its input was being zeroed first. It now fetches the window and bounds it
  by wall clock against each entry's `ts`; an entry with no usable timestamp is
  kept, because dropping a real error over a missing clock field is worse.
- `load_toolset` says that "loaded" means *advertised*. It answered with 70+ tools
  loaded while every one stayed absent from the client's callable surface, and
  nothing in the response indicated that was possible. The server expands its
  advertised list and emits `tools/list_changed`; a host that does not act on that
  notification leaves the tools uncallable, and the server cannot take that step for
  it. The caveat lived in the tool description only — the response now carries a
  `client_hint` naming the host's step and the `ROBLOX_MCP_LAZY_TOOLS=0` escape.
- `project_reconcile_plan` reports where its time went. A healthy two-tool project
  was reported taking about 160 seconds to return a one-step plan, "without timeout
  diagnostics". Every phase of the inspection is synchronous and individually
  bounded — the toolchain shim probes cap at 5s each — so the code alone does not
  explain it, and I could not reproduce it without that project's toolchain. The
  plan now carries a `timingsMs` breakdown per phase plus a total, so the next
  occurrence names its own culprit instead of being opaque. Excluded from
  `planHash`: timings are observation, not plan content.
- A playtest peer's runtime logs survive the end of the test. The log buffer lives
  inside the runtime DataModel, so it died with the peer: once a play/multiplayer
  test ended, `get_runtime_logs` for `server` / `client-N` answered
  `target_role_not_present_on_instance` and the whole session's gameplay output was
  gone — precisely when post-test QA wants it. The teardown paths now snapshot each
  runtime peer's buffer on the way out and serve it afterwards, marked `retained`
  with the capture time and a note, for ten minutes. A peer that never answers costs
  the retention, never the shutdown: each fetch is capped at two seconds, and the
  snapshot never delays the stop signal itself.
- Roblox's own CoreScript errors no longer read as a game regression. Multiplayer
  QA on an unpublished place (`PlaceId = 0`) repeatably logs `Invalid value for enum
  CreatorType` from `CoreGui.RobloxGui.Modules.PlayerPermissionsModule` and its
  PlayerList/TopBar follow-ups while the place's own scripts run fine. Those lines
  are now split out of the episode verdict and reported under `logs.engineNoise`
  with a count and a note in the hint — set aside, never dropped — and they are kept
  out of `implicatedScripts` so an agent is not sent to fix Roblox's UI. Reported
  before log severity was fixed, when no error counted at all; that fix is what
  makes this necessary rather than cosmetic.
- Runtime log severity is matched against the level the plugin actually sends.
  `RuntimeLogBuffer` tags entries `ERR` / `WARN` / `INFO` / `OUT` and sends no
  `messageType`, but both readers were written against Roblox's `Enum.MessageType`
  names. `diagnose_scripts` required `messageType` to be a string and skipped every
  entry, so it answered "Looks clean" for a buffer holding seven warnings.
  `run_playtest_episode` tested `level.includes('error')` — and `"err"` does not
  contain `"error"` — so `errorCount` was always 0 and **no runtime error could fail
  an episode verdict**; only a failed assertion could. `"warn"` matched by luck,
  which is why warnings worked and hid the problem. Both now share one `logSeverity`
  classifier that understands either vocabulary.
- Deleting an instance can be undone. `delete_object` wrapped `Destroy()` in a
  ChangeHistoryService recording, but `Destroy()` tears an instance down
  irreversibly, so there was nothing left to restore: `undo` answered "Undo
  executed successfully" while the object stayed gone. Undoing a *creation* and
  a *property change* both worked, which is why the plumbing looked healthy and
  only deletes were silently unrecoverable — the one case undo exists for.
  Deletes now unparent, which is what Studio's own Delete does (verified live:
  unparent restores, `Destroy()` does not). Safe because these handlers only run
  in the edit DataModel, where the connections `Destroy()` would sever are not
  live anyway.
- `get_changes_since` actually returns the `scope` field it advertises. The
  scoping change added `scope` to the emitted Luau, the output schema and the
  tool description, but `_captureFingerprint` parsed only
  `fingerprint`/`count`/`truncated` and dropped it — so the one tool of the four
  that reshapes its payload in TypeScript promised a field that never arrived.
  The sibling tools pass the Luau result straight through and were unaffected.
- `scene_search`, `get_changes_since` and `get_scene_summary` now scope to the
  place too. Only `get_world_snapshot` was fixed; its three sibling generators
  still started from `game` and walked all 1714 DataModel descendants of an empty
  baseplate, 1676 of them Studio's own. `scene_search` was the damaging one: on
  that place `"button"` returned 58 hits and every single one was Studio's
  viewport widget (`CoreGui.ViewSelectorScreenGui.Panel.ArrowButtons...`), so the
  tool for "where is the shop UI" answered with the editor's own chrome and would
  bury real content under it. `get_changes_since` spent 202KB of fingerprint
  payload on that noise to carry 3KB of real content. The scoping rule now lives
  in one shared Luau prelude (`PLACE_SCOPE_LUA`) that all four generators use,
  each reporting a `scope` field; an explicit path is still never filtered.
  Idle Studio produced no phantom diffs, so this is cost and relevance, not
  correctness, for `get_changes_since`.
- `smart_duplicate` actually applies its property variations. The option is the
  tool's headline feature, but the values were assigned raw inside a discarded
  `pcall`: no `convertPropertyValue`, so the documented forms (`Color` as
  `[255, 0, 0]`, `Position` as `{x, y, z}`) arrived as Lua tables the engine
  rejects, and the swallowed error meant the tool reported `succeeded: 2,
  failed: 0` with **no variation applied at all** — verified live, both clones
  kept the source colour. It now routes through the same `applyProperties`
  helper `create_object` uses, so values convert and any that still fail come
  back in `propertyErrors` instead of vanishing.
- `get_world_snapshot` counts the place, not Studio. At `game` level it walked
  the whole DataModel, which also holds Studio's own plumbing: on an empty
  baseplate 1677 of 1713 descendants were `Stats`, `StylingService`,
  `MemStorageService`, `PluginGuiService` and `CoreGui`. The tool whose job is
  answering "is the scene heavy" reported 1713 for a place containing 36
  instances, and its top classes were `StatsItem` and `StyleRule`. It now scans
  the services a place stores, names that in a `scope` field rather than quietly
  returning different numbers, and leaves any explicitly requested path
  unfiltered. The existing code already skipped *empty* services for the same
  reason; this extends that to the non-empty internal ones.
- Plugin validation errors no longer carry the plugin's own source location.
  Ten `error(...)` calls omitted the level argument, so a caller asking for an
  ambiguous `edit_script_lines` got
  `user_MCPPlugin.rbxmx.MCPPlugin.modules.handlers.ScriptHandlers:484: old_string
  matches multiple locations...` instead of the guidance alone. `LuauExec`
  already passed `0` at its three sites; the handlers now do too.
- Every tool input property declares a JSON-Schema type. Thirteen polymorphic
  parameters had no `type` at all, and an untyped property is not "accepts
  anything" to an MCP client — it is one the client cannot validate, so the
  value arrives as a string. `environment_set_time_of_day` was the worst case:
  `time: 14.75` reached the plugin as `"14.75"`, `Lighting.TimeOfDay` read that
  as 14 hours 75 minutes, and the tool set **15:15** while reporting success.
  The same call over the HTTP endpoint, where the number stays a number, was
  always correct. `set_attribute` was silently storing numbers as string
  attributes. A schema test now fails on any untyped property.
- `environment_set_time_of_day` reads a bare numeric string as a ClockTime. A
  TimeOfDay string always carries colons, so `"14.75"` is unambiguous, and the
  tool no longer depends on the client preserving the number.
- `set_attribute` honours its own `valueType` hint for scalars. The parameter is
  documented as "type hint if needed", but the plugin only consulted it for
  table values and returned scalars untouched — so it did nothing in exactly the
  case that needs a hint.
- `create_object` and `mass_create_objects` no longer report success while
  silently dropping properties. Both create paths assigned each property inside
  a bare `pcall(...)` whose result was discarded, so a Part asked for with a
  given Size and Position came back at the default 4x1.2x2 at the origin with
  `success: true` and "Object created successfully". Failures now come back as
  `propertyErrors`, the way `set_properties` already reported them; the instance
  is still created.
- Vector3 and Color3 values are accepted under either key casing. The plugin's
  property conversion only recognized `{X, Y, Z}` and `{R, G, B}`, so the
  equally natural `{x, y, z}` fell through unconverted and the engine rejected
  the raw table — which is what the swallowed `pcall` above was hiding. Colour
  components above 1 are read as 0-255: `Color3.new(255, 80, 40)` neither errors
  nor clamps, it just renders wrong. The accepted value shapes are now spelled
  out in the tool schemas instead of "object for Vector3/Color3/UDim2".
- Generated-Luau tools return the decoded Luau table and report Luau-level
  errors. The plugin JSON-*encodes* a table return into the `returnValue`
  string, and this one funnel handed the raw envelope back, so scene summary,
  the UI/environment/terrain builders, media, `design_lint` and `apply_theme`
  all produced double-encoded JSON, and a Luau `{ error = ... }` still arrived
  as `success: true` with "Code executed successfully". `design_review` read
  `.returnValue.newPath` off that string, always got `undefined`, and could
  never get past staging. They now use `normalizeExecuteLuauToolResult`, the
  normalizer the world-model, mutation and runtime tools already share.
- `tool_catalog_search` ranks the obvious tool first for a plain-English task. A
  name hit was a plain substring test, so "a" scored on "cre[a]te_build" and
  "an" on "m[an]age_instance", and filler outweighed the one word that mattered:
  "create a part and set its color" returned `environment_set_atmosphere`,
  `animation_create` and `asset_source_search`, and recommended loading
  media/environment/assets/build — never `mutation`. Filler words are dropped
  and a name hit has to land on a whole `_`-separated token.
- The release workflow's asset upload can find the repository. That job has no
  checkout on purpose — it is the only one holding `contents: write` — so `gh`
  had no git remote to infer from and failed with "not a git repository". It now
  gets `GH_REPO`. The job is release-only, so the rehearsal never ran it and
  v4.0.3 was the first execution; its assets were attached by hand from the
  artifact the same run produced.
- `publish.mjs` waits for a published version to become visible instead of
  failing on the first 404. The retry helper treated `absent` as a definitive
  answer, which is right *before* publishing and wrong *after* it: a new version
  takes seconds to replicate, so the post-publish check returned immediately and
  failed a release whose publish had succeeded. Each of the two v4.0.3 packages
  hit this. Re-running was safe — an already-published version is skipped — but
  the failure said the opposite of what had happened, so the message now says
  so too.
- `docs:check` compares generated tool docs by content rather than by bytes. The
  generator writes LF and a Windows checkout rewrites the working copy to CRLF,
  so the gate reported "out of date" on a file that had not changed, and
  regenerating produced a whitespace-only diff to commit. Real content drift
  still fails. `scripts/generate-protocol-policy.mjs` already normalized for
  this; the tool-docs generator did not.
- `isAddressInUseError` also treats `EPERM` as a duplicate-bridge signal, not
  just `EADDRINUSE`. A second BloxForge launch could intermittently fail with
  `listen EPERM: operation not permitted 127.0.0.1:<port>` instead of entering
  proxy mode, because macOS can report a duplicate loopback bind as `EPERM`
  under a sandboxed parent process rather than the `EADDRINUSE` Node normally
  uses to signal it. Either code now means the same thing: a primary already
  owns the bridge.

### Documentation
- Renamed `AGENTS.md` to `CLAUDE.md` so Claude Code reads the repository's
  actual operating guide instead of the GitNexus stub that previously lived
  under that name; the `.gitignore` split flips accordingly, so the
  GitNexus-generated `AGENTS.md` duplicate is now the ignored one. Fixed the
  two dangling `AGENTS.md` links this left in `README.md` and `docs/README.md`.
- Extracted the GitNexus `<!-- gitnexus:start -->` block into
  `docs/gitnexus-agent-guide.md` and expanded it with the tools the inline
  block omitted (`trace`, `rename`, `cypher`, `check`, `route_map`,
  `shape_check`, `api_impact`, `tool_map`, `group_list`/`group_sync`,
  `list_repos`), leaving a short pointer behind the markers in `CLAUDE.md`.
  `gitnexus analyze` still rewrites that inline block on every re-index, so
  the extracted doc — not the marked block — is the one to keep current.
- Un-ignored `.claude/skills/` (carved out of the blanket `.claude/`
  credential rule): those are plain generated skill docs that `CLAUDE.md`
  links to, and a fresh clone had no way to get them without re-running
  GitNexus locally first.
- Fixed `CONTRIBUTING.md`'s dead `todo.md` link and updated
  `docs/known-limitations.md`'s Orchestration section, which still claimed
  there was no unified "get this project running" tool after
  `project_reconcile_plan`/`_apply`/`_status` had already shipped.

## [4.0.3] - 2026-08-02

### Added
- `project_reconcile_plan`, `project_reconcile_apply` and
  `project_reconcile_status`. Every individual operation was already safe; what
  was missing was the order. An agent had to work out for itself that
  `rokit_status` precedes `rokit_install`, that a Wally install is pointless
  before the lock validates, and that a sourcemap generated before the packages
  exist describes a tree that does not. Reconcile owns that order and nothing
  else: it composes the same tools, behind the same plan/confirm/`planHash`
  contract, rather than becoming a second and less-reviewed way to run them.

  It restores declared state and never invents new state. Installing the exact
  version the manifest pins, or the packages the lock resolved, is a repair;
  choosing a version, resolving a new lock, editing the Rojo tree or migrating
  Aftman is a decision, and each returns as a blocked step naming the
  `[automation]` flag in `bloxforge.toml` that would permit it. Applies run
  under a single-writer lease at `.bloxforge/locks/project-reconcile.lock`, so a
  second agent gets `another_reconcile_is_running` rather than a half-applied
  project, and a lease whose process is gone is treated as stale. Each run
  journals to `.bloxforge/reconcile/<runId>.json`, so the same `runId` resumes
  an interrupted run instead of repeating finished steps. State is re-read after
  every mutation rather than precomputed once: `rokit_install` changes which
  tools exist, which changes what the remaining steps should be. Every run ends
  on the full strict project verify.
- A canonical `protocol-endpoints.json` source and generated Studio policy, with
  a check that fails builds when the TypeScript and Luau protocol surfaces
  drift apart.
- A reduced Inspector plugin build with read-only routes and mutation-only
  handler modules excluded from the package.
- Regression coverage for Open Cloud and cookie clients, build sandboxing,
  Studio process identity checks, mutation confirmation, protocol policy and
  Inspector package boundaries.
- A checksum-verified Lune 0.10.5 bootstrap for local and CI runtime smoke
  tests, so a clean checkout can run the release gate without manual setup.

### Changed
- Split Studio route policy into main and Inspector modules and moved the
  diagnostics dashboard out of the 1,200-line HTTP server module.
- Removed deprecated `sync_pull`, `sync_status` and `sync_push` from the public
  tool catalog and registry. Hashed `rojo_syncback_plan` →
  `rojo_syncback_apply` is now the only advertised sync mutation path.
- Pinned every third-party GitHub Action to a full commit SHA and added one
  stable `Required` CI aggregation job for branch rulesets.
- Replaced 43 explicit-`any` lint warnings with typed transport, health,
  process-failure, sourcemap and Express application boundaries. The single
  schema-validated legacy dispatch boundary is documented and locally scoped.

### Fixed
- The Inspector plugin could not load. `ClientBroker` is packaged in both
  variants and requires `InputHandlers`, `EvalRuntimeHandlers` and
  `BreakpointHandlers`, which the reduced Inspector build omits, so the first
  require failed and the plugin never started. Those three now redirect to
  Inspector stubs that refuse the endpoint, keeping runtime Luau execution out
  of the read-only package. `build-plugin.mjs` refuses to package a variant that
  requires a module it does not ship, which is the check the assertions on the
  finished asset cannot make: an omitted module is missing from the asset for
  exactly the reason it is supposed to be missing.
- `InspectorBreakpointHandlers` exported a default object, but its callers are
  compiled against the real module's `export =` and index the module table
  directly, so `BreakpointHandlers.init(plugin)` would have been nil even once
  the module resolved. The stubs now mirror the surface they stand in for.
- The Inspector source rewrite fails the build when it matches nothing. It is
  the only thing pointing the Inspector at its own modules, and a silent miss —
  a rename, or roblox-ts emitting an import differently — shipped a plugin that
  only reported the problem in Studio.
- The pinned Lune bootstrap caches under the user's home instead of the system
  temp directory. A cache hit skips the checksum, and `/tmp` is writable by
  every local account, so the previous path let anyone with an account on the
  machine have the release gate execute their binary. `BLOXFORGE_TOOL_CACHE`
  still overrides it.
- `shapeListResponse` no longer promises a `pagination` block it does not always
  attach. Four of its five paths return the caller's object untouched, so a
  caller reading `.pagination` type-checked and got `undefined`.
- Protocol policy freshness checks now normalize line endings, so a Windows
  checkout using CRLF does not report generated TypeScript as stale. The check
  still rejects actual content drift and has a cross-platform regression test.

## [4.0.2] - 2026-08-02

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
- The `rojo serve` settle window watches `error` as well as `exit`, and
  readiness re-checks the process state after the wait rather than overwriting
  it. Node documents that "the `exit` event may or may not fire after an error
  has occurred", so an `exit`-only wait could time out and answer "the child
  survived" for a process that never ran, letting a foreign Rojo on the port be
  adopted. This is hardening against that documented behaviour, not a fixed
  failure: on the Node versions in CI a failed spawn does emit `exit`, so the
  case is not reproducible here and no test isolates it. The settle window
  itself is covered by a test that fails without it.
- `wally_validate_lock` compares build metadata as the release version.
  `1.2.3+build.5` does not differ from `1.2.3` for compatibility, so reporting
  it `unverifiable` — and therefore failing `ok` — was wrong. Only a `-`
  prerelease suffix stays unverifiable.
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
- Enforced the Inspector plugin's read-only boundary twice: the bridge now
  refuses mutation endpoints for a registered Inspector session, and the
  plugin itself rejects every endpoint outside the manifest-backed read
  allowlist. Previously a full server could route `/api/delete-object` (and
  every other mutation handler compiled into the shared plugin) to an
  Inspector session because `pluginVariants` was metadata only. The manifest
  now uses the real `main` variant name while retaining `full` as an input
  compatibility alias, and regression tests keep the plugin allowlist synced.
- Passed `--runInBand` through the cross-platform CI job to Jest rather than to
  the nested npm process, which ignored it with an unknown-config warning.
- Made the read-only-directory installer test skip environments that cannot
  enforce Unix mode bits (Windows and UID 0), so root-based containers no
  longer fail while testing a permission condition they cannot represent.
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
- Added the evals install step to the agent setup guide and corrected its
  serialized Jest command so a fresh checkout can run the documented gates.
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

[unreleased]: https://github.com/princeofscale/bloxforge/compare/v4.3.0...HEAD
[4.3.1]: https://github.com/princeofscale/bloxforge/compare/v4.3.0...v4.3.1
[4.3.0]: https://github.com/princeofscale/bloxforge/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/princeofscale/bloxforge/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/princeofscale/bloxforge/compare/v4.0.3...v4.1.0
[4.0.3]: https://github.com/princeofscale/bloxforge/compare/v4.0.2...v4.0.3
[4.0.2]: https://github.com/princeofscale/bloxforge/compare/v4.0.1...v4.0.2
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
