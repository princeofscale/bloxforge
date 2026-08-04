---
name: safety
description: "Skill for the Safety area of bloxforge. 10 symbols across 2 files."
---

# Safety

10 symbols | 2 files | Cohesion: 100%

## When to Use

- Working with code in `packages/`
- Understanding how stripLuauStringsAndComments, longBracketLevel, skipLongBracket work
- Modifying safety-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/safety/safety-manager.ts` | stripLuauStringsAndComments, longBracketLevel, skipLongBracket, assess, isProtectedPath (+1) |
| `packages/core/src/tools/index.ts` | isProtectedPath, _safetyGate, _formatSafety, backupScript |

## Entry Points

Start here when exploring this area:

- **`stripLuauStringsAndComments`** (Function) — `packages/core/src/safety/safety-manager.ts:103`
- **`longBracketLevel`** (Function) — `packages/core/src/safety/safety-manager.ts:108`
- **`skipLongBracket`** (Function) — `packages/core/src/safety/safety-manager.ts:116`
- **`isProtectedPath`** (Function) — `packages/core/src/tools/index.ts:331`
- **`backupScript`** (Function) — `packages/core/src/tools/index.ts:324`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `stripLuauStringsAndComments` | Function | `packages/core/src/safety/safety-manager.ts` | 103 |
| `longBracketLevel` | Function | `packages/core/src/safety/safety-manager.ts` | 108 |
| `skipLongBracket` | Function | `packages/core/src/safety/safety-manager.ts` | 116 |
| `isProtectedPath` | Function | `packages/core/src/tools/index.ts` | 331 |
| `backupScript` | Function | `packages/core/src/tools/index.ts` | 324 |
| `assess` | Method | `packages/core/src/safety/safety-manager.ts` | 232 |
| `isProtectedPath` | Method | `packages/core/src/safety/safety-manager.ts` | 307 |
| `_safetyGate` | Method | `packages/core/src/tools/index.ts` | 537 |
| `_formatSafety` | Method | `packages/core/src/tools/index.ts` | 555 |
| `backupScript` | Method | `packages/core/src/safety/safety-manager.ts` | 324 |

## How to Explore

1. `context({name: "stripLuauStringsAndComments"})` — see callers and callees
2. `query({search_query: "safety"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
