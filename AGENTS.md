# BloxForge agent guide

This file is the primary operating guide for AI coding agents working in this repository. Follow any more specific `AGENTS.md` found deeper in the tree as well.

## Project purpose

BloxForge is a local-first Model Context Protocol server and Roblox Studio plugin. It lets MCP clients inspect and modify Roblox experiences through a localhost bridge. Preserve local-only operation, user control, and compatibility with existing MCP clients.

## Repository map

- `packages/core/` — shared tool definitions, handlers, bridge code, builders, and tests.
- `packages/robloxstudio-mcp/` — main CLI and published full server package.
- `packages/robloxstudio-mcp-inspector/` — read-focused inspector CLI and package.
- `packages/studio-plugin/` — TypeScript source compiled into the Roblox Studio Luau plugin.
- `scripts/` — build, documentation, package, release, and smoke-test utilities.
- `tests/` — repository-level integration and regression coverage.
- `docs/` — maintained user and contributor documentation.
- `evals/` — evaluation fixtures and scenarios.

Do not commit generated build output, package tarballs, installed Studio plugins, credentials, or local tool state.

## Working rules

1. Inspect the current branch, worktree, and relevant tests before editing. Preserve unrelated user changes.
2. Fix behavior at the shared layer when both the full server and inspector are affected.
3. Keep tool schemas, handlers, facade exports, output schemas, tests, and generated documentation synchronized.
4. Treat the localhost bridge and plugin protocol as a compatibility boundary. Avoid silent request or response shape changes.
5. Keep the plugin load order deterministic. Plugin changes must be validated against compiled Luau, not only TypeScript source.
6. Keep secrets out of source, logs, fixtures, changelogs, commits, and command output. Never print npm or GitHub tokens.
7. Prefer small, direct changes using existing utilities and dependencies. Do not add abstractions or packages without a concrete need.
8. Use Conventional Commits. Every important change or fix—behavioral, user-visible, operational, security, compatibility, or release-related—must be recorded under `CHANGELOG.md`'s `[Unreleased]` section before it is committed.
9. Do not edit generated tool-reference content by hand; regenerate it with the repository scripts.
10. Do not use destructive Git operations or rewrite shared history unless the user explicitly requests it.

## Local validation

Install exact dependencies with:

```sh
npm ci
```

Run checks relevant to the change. Before a release, run the complete set:

```sh
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build:all
npm run test:plugin:smoke
npm run test:plugin:runtime
npm run docs:check
npm run verify-package
npm run release:check
```

Use a temporary `MCP_PLUGINS_DIR` while developing or testing plugin installation so the real Roblox Studio plugin directory is not modified.

## Documentation

Keep `README.md`, `docs/architecture.md`, `docs/known-limitations.md`, `docs/tools-reference.md`, and `docs/troubleshooting.md` aligned with the product. Add a new documentation file only when the information does not fit one of these maintained documents.

## Release checklist

1. Set the same version in the root package, every published workspace, and `package-lock.json`.
2. Move completed entries into the matching `CHANGELOG.md` release section.
3. Run `npm run release:check` and confirm the working tree contains only intended release changes.
4. Create and push `v<version>` only after the release commit is on the default branch, then publish the GitHub Release for that tag.
5. Publishing the GitHub Release triggers both npm package publishes and uploads the full and inspector Studio plugin assets. Prereleases such as `-rc.1` use the npm `next` dist-tag and a GitHub prerelease.
6. Verify the npm package versions, dist-tags, GitHub release assets, and workflow status before declaring the release complete.
