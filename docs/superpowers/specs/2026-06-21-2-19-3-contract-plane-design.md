# RobloxStudio MCP 2.19.3 Contract Plane Design

## Context

The post-2.19 review points in the right direction: the project should now harden
contracts and state transport instead of only adding more tools. The current
checkout has already implemented several recommendations in 2.19.1 and 2.19.2:
resources, server instructions, dual-format `structuredContent`, live playtest
sampling, transactional mutation plans, recipes, gameplay assertions, eval-validated
lazy loading, and version/documentation drift cleanup.

2.19.3 should therefore focus on the remaining high-ROI items from the review:
published output contracts, schema conformance, one low-risk maintainability split,
and release metadata. MCP Apps and embeddings remain gated follow-ups because the
review itself recommends not forcing them before contract/resources are stable and
before evals show lexical search failure.

## Goals

- Publish strict `outputSchema` only for tools whose outputs are already stable,
  object-shaped, and testable.
- Keep backward compatibility by continuing to return both `structuredContent` and
  the same payload as JSON text in `content`.
- Add validation and golden tests so published schemas are real contracts, not
  hand-written metadata that can drift.
- Continue reducing `RobloxStudioTools` without risky cross-cutting rewrites.
- Prepare the release as 2.19.3 with changelog, README, package, and plugin metadata
  aligned.

## Non-Goals

- No full MCP Apps implementation in this release. Track F stays host-gated until
  there is a verifiable target host flow.
- No embeddings/vector index in this release. Track H stays data-gated until evals
  show lexical `scene_search` recall is the bottleneck.
- No full migration to MCP Tasks. Existing async Luau job tools remain the stable
  UX; any future Tasks work should be an adapter.
- No strict schema publication for tools that return unstable Roblox property maps,
  raw text, files, screenshots, binary payloads, or host/client-dependent results
  without a focused schema and tests.

## Approach

Use a conservative contract-first rollout.

1. Add an internal tool output contract registry.
   - Keep the existing `TOOL_DEFINITIONS` public surface compatible.
   - Associate selected tool names with JSON Schema output contracts.
   - Provide a small helper for attaching schemas to tool definitions.
   - Avoid a large `registerTool(...)` rewrite in this release unless the codebase
     already has a safe local insertion point. The registry should be compatible
     with a later declarative registration refactor.

2. Publish schemas for the first wave of tools.
   - Discovery: `tool_catalog_search`, `load_toolset`.
   - World model: `get_world_snapshot`, `get_node_batch`, `get_changes_since`,
     `scene_search`.
   - Asset preflight: `asset_preflight_insert`.
   - Runtime/product-frontier tools already added from the review:
     `playtest_sample_state`, `run_gameplay_assertions`.
   - Composite safety/build tools already added from the review:
     `apply_mutation_plan`, `list_recipes`, `apply_recipe`.

3. Validate contracts in CI.
   - Add schema shape tests: every selected tool definition exposes `outputSchema`.
   - Add golden output validation for representative pure builders and mocked tool
     responses where live Studio is not required.
   - Add a guard that no tool advertises `outputSchema` unless it has at least one
     focused conformance test or golden fixture.

4. Continue maintainability work with one domain split if safe.
   - Prefer `AssetTools` only if the move can preserve behavior with existing tests
     plus targeted unit coverage around client wiring.
   - If `AssetTools` proves too entangled for a clean release, defer it and keep
     2.19.3 focused on output contracts.

5. Release hygiene.
   - Bump package and plugin versions to 2.19.3.
   - Update README tool/test counts if they change.
   - Update TODO to mark completed contract work and keep Apps/embeddings gated.
   - Add a changelog entry that distinguishes strict published `outputSchema` from
     the already-shipped `structuredContent` channel.

## Architecture

Add a small contract layer near the existing tool-definition modules:

- `tools/output-schemas.ts` exports JSON Schema objects keyed by tool name.
- `tools/definitions.ts` or the definition aggregation path applies matching
  `outputSchema` values when exporting definitions.
- `tools/structured-output.ts` remains responsible for converting existing handler
  results into dual-format `structuredContent` and JSON text.
- Tests import the same schema registry and validate representative outputs against
  it.

This keeps the public tool list stable while making published schemas constructive:
the same source used to advertise `outputSchema` is used by tests.

## Data Flow

Tool execution remains unchanged:

1. Client calls a tool.
2. Existing handler returns a JS value or throws.
3. Existing dispatch wraps successful object payloads into `structuredContent` and
   JSON text.
4. Existing error dispatch returns the typed error envelope.
5. For selected tools, the advertised definition now includes `outputSchema`.

For tests, representative outputs are generated from pure builders or mocked handler
returns, then validated against the schema registry.

## Error Handling

Published output schemas cover successful payloads. Failures continue to use the
current typed error envelope with `isError: true`; this release should not mix success
schemas and error envelope schemas unless the SDK/client behavior is proven stable.

Schema validation failures in tests are hard failures. Runtime validation can remain
test-only for 2.19.3 to avoid surprising live client behavior or performance overhead.

## Testing

- Run `npm run typecheck`.
- Run `npm test`.
- Add focused tests for:
  - selected tools include `outputSchema`;
  - each schema is valid JSON Schema-shaped data;
  - representative structured outputs validate against their advertised schema;
  - dual-format response shape remains unchanged.
- If `AssetTools` is split, add focused tests for constructor wiring and critical
  public methods, then dogfood live before release.

## Rollout

2.19.3 ships as a compatibility-preserving contract hardening release. Existing
clients still read `content[0].text`; newer clients can consume `structuredContent`
and validate selected `outputSchema` contracts.

Apps, embeddings, full declarative registration, HTTP lazy mirroring, and MCP Tasks
adapter work remain explicit follow-ups after this contract layer is stable.
