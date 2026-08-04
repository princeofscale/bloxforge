---
name: cluster-10
description: "Skill for the Cluster_10 area of bloxforge. 10 symbols across 4 files."
---

# Cluster_10

10 symbols | 4 files | Cohesion: 77%

## When to Use

- Working with code in `packages/`
- Understanding how listenWithRetry, resolveBridgeHost, resolveBridgePort work
- Modifying cluster_10-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/server.ts` | resolveBridgeHost, resolveBridgePort, isAddressInUseError, run |
| `packages/core/src/bridge-service.ts` | envRequestTimeout, BridgeService |
| `packages/core/src/http-server.ts` | listenWithRetry, bindPort |
| `packages/core/src/proxy-bridge-service.ts` | ProxyBridgeService, stop |

## Entry Points

Start here when exploring this area:

- **`listenWithRetry`** (Function) — `packages/core/src/http-server.ts:1004`
- **`resolveBridgeHost`** (Function) — `packages/core/src/server.ts:40`
- **`resolveBridgePort`** (Function) — `packages/core/src/server.ts:44`
- **`BridgeService`** (Class) — `packages/core/src/bridge-service.ts:272`
- **`ProxyBridgeService`** (Class) — `packages/core/src/proxy-bridge-service.ts:4`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `BridgeService` | Class | `packages/core/src/bridge-service.ts` | 272 |
| `ProxyBridgeService` | Class | `packages/core/src/proxy-bridge-service.ts` | 4 |
| `listenWithRetry` | Function | `packages/core/src/http-server.ts` | 1004 |
| `resolveBridgeHost` | Function | `packages/core/src/server.ts` | 40 |
| `resolveBridgePort` | Function | `packages/core/src/server.ts` | 44 |
| `stop` | Method | `packages/core/src/proxy-bridge-service.ts` | 79 |
| `run` | Method | `packages/core/src/server.ts` | 287 |
| `envRequestTimeout` | Function | `packages/core/src/bridge-service.ts` | 251 |
| `bindPort` | Function | `packages/core/src/http-server.ts` | 1036 |
| `isAddressInUseError` | Function | `packages/core/src/server.ts` | 77 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Run → DefaultRequestJournalPath` | cross_community | 3 |
| `Run → RequestJournal` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_6 | 2 calls |
| Rojo | 1 calls |
| Tools | 1 calls |
| Toolchain | 1 calls |
| Cluster_12 | 1 calls |

## How to Explore

1. `context({name: "listenWithRetry"})` — see callers and callees
2. `query({search_query: "cluster_10"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
