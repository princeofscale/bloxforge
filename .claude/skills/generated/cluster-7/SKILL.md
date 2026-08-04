---
name: cluster-7
description: "Skill for the Cluster_7 area of bloxforge. 10 symbols across 3 files."
---

# Cluster_7

10 symbols | 3 files | Cohesion: 71%

## When to Use

- Working with code in `packages/`
- Understanding how resolveRequestTimeout, protocolPolicy, RequestOutcomeUnknownError work
- Modifying cluster_7-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/bridge-service.ts` | RequestOutcomeUnknownError, resolveRequestTimeout, expireRequest, cleanupStaleAliases, unregisterInstance (+3) |
| `packages/core/src/protocol-manifest.ts` | protocolPolicy |
| `packages/core/src/proxy-bridge-service.ts` | sendRequest |

## Entry Points

Start here when exploring this area:

- **`resolveRequestTimeout`** (Function) — `packages/core/src/bridge-service.ts:244`
- **`protocolPolicy`** (Function) — `packages/core/src/protocol-manifest.ts:55`
- **`RequestOutcomeUnknownError`** (Class) — `packages/core/src/bridge-service.ts:152`
- **`expireRequest`** (Method) — `packages/core/src/bridge-service.ts:473`
- **`cleanupStaleAliases`** (Method) — `packages/core/src/bridge-service.ts:527`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `RequestOutcomeUnknownError` | Class | `packages/core/src/bridge-service.ts` | 152 |
| `resolveRequestTimeout` | Function | `packages/core/src/bridge-service.ts` | 244 |
| `protocolPolicy` | Function | `packages/core/src/protocol-manifest.ts` | 55 |
| `expireRequest` | Method | `packages/core/src/bridge-service.ts` | 473 |
| `cleanupStaleAliases` | Method | `packages/core/src/bridge-service.ts` | 527 |
| `unregisterInstance` | Method | `packages/core/src/bridge-service.ts` | 666 |
| `cleanupStaleInstances` | Method | `packages/core/src/bridge-service.ts` | 830 |
| `cleanupOldRequests` | Method | `packages/core/src/bridge-service.ts` | 1246 |
| `isMutation` | Method | `packages/core/src/bridge-service.ts` | 1312 |
| `sendRequest` | Method | `packages/core/src/proxy-bridge-service.ts` | 101 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `SendRequest → ProtocolPolicy` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_12 | 8 calls |
| Cluster_118 | 1 calls |
| Tools | 1 calls |
| Cluster_9 | 1 calls |

## How to Explore

1. `context({name: "resolveRequestTimeout"})` — see callers and callees
2. `query({search_query: "cluster_7"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
