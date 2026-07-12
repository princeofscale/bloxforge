# BloxForge Packages Renaming & Migration Plan

This document outlines the migration path for renaming the package directories from `robloxstudio-mcp` to neutral names, ensuring zero disruption to existing installations and compatibility.

## Current State

- `/packages/robloxstudio-mcp/` -> Published as `@princeofscale/bloxforge`
- `/packages/robloxstudio-mcp-inspector/` -> Published as `@princeofscale/bloxforge-inspector`
- `/packages/core/` -> Internal shared package `@princeofscale/bloxforge-core`

## Target State

- `/packages/server/` -> `@princeofscale/bloxforge`
- `/packages/inspector/` -> `@princeofscale/bloxforge-inspector`
- `/packages/core/` -> `@princeofscale/bloxforge-core`

---

## Renaming & Migration Steps

### Phase 1: Local Renaming (Atomic PR)
1. **Rename Directories**:
   - `git mv packages/robloxstudio-mcp packages/server`
   - `git mv packages/robloxstudio-mcp-inspector packages/inspector`

2. **Update Root `package.json`**:
   - Update scripts referring to `packages/robloxstudio-mcp` and `packages/robloxstudio-mcp-inspector`.
   - Update dependencies and devDependencies references if any.

3. **Update Workspace Configs**:
   - The workspace glob `"packages/*"` in root `package.json` will automatically pick up the new folders.

4. **Update Build Scripts**:
   - Update `scripts/build-plugin.mjs` and package `tsup.config.ts` configs to reflect the new paths.

5. **Update imports inside packages**:
   - Any local imports pointing to `@princeofscale/bloxforge` or `@princeofscale/bloxforge-inspector` (e.g. in tests) should be checked.

### Phase 2: Configuration & Path Resolution Compatibility
1. **Windows, macOS, Linux local directories**:
   - We must retain fallback compatibility for user state directories (implemented in v2.20.2 via fallback detection).
   - Any references to `.robloxstudio-mcp` or `robloxstudio-mcp` in state/cache paths must be mapped with fallback.

2. **Environment Variables**:
   - Support both `BLOXFORGE_*` and `ROBLOXSTUDIO_MCP_*` variables.

### Phase 3: Verification Checklists
- Run `npm install`
- Run `npm run build`
- Run `npm run typecheck`
- Run `npm test`
- Run `npm pack --dry-run` to inspect generated tarballs and ensure no paths desynced.
