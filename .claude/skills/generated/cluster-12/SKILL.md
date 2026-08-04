---
name: cluster-12
description: "Skill for the Cluster_12 area of bloxforge. 20 symbols across 3 files."
---

# Cluster_12

20 symbols | 3 files | Cohesion: 73%

## When to Use

- Working with code in `packages/`
- Understanding how journalSnapshot, persistJournal, transitionRequestStatus work
- Modifying cluster_12-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/bridge-service.ts` | journalSnapshot, persistJournal, transitionRequestStatus, addRequestNotifier, releasePendingRequest (+11) |
| `packages/core/src/http-server.ts` | attachBridgeWebSocket, deliver |
| `packages/core/src/request-journal.ts` | save, compact |

## Entry Points

Start here when exploring this area:

- **`journalSnapshot`** (Method) — `packages/core/src/bridge-service.ts:355`
- **`persistJournal`** (Method) — `packages/core/src/bridge-service.ts:377`
- **`transitionRequestStatus`** (Method) — `packages/core/src/bridge-service.ts:420`
- **`addRequestNotifier`** (Method) — `packages/core/src/bridge-service.ts:751`
- **`releasePendingRequest`** (Method) — `packages/core/src/bridge-service.ts:1125`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `journalSnapshot` | Method | `packages/core/src/bridge-service.ts` | 355 |
| `persistJournal` | Method | `packages/core/src/bridge-service.ts` | 377 |
| `transitionRequestStatus` | Method | `packages/core/src/bridge-service.ts` | 420 |
| `addRequestNotifier` | Method | `packages/core/src/bridge-service.ts` | 751 |
| `releasePendingRequest` | Method | `packages/core/src/bridge-service.ts` | 1125 |
| `releasePendingRequestsForSession` | Method | `packages/core/src/bridge-service.ts` | 1138 |
| `reconcilePluginReceipts` | Method | `packages/core/src/bridge-service.ts` | 1154 |
| `acknowledgeRequest` | Method | `packages/core/src/bridge-service.ts` | 1198 |
| `resolveRequest` | Method | `packages/core/src/bridge-service.ts` | 1204 |
| `rejectRequest` | Method | `packages/core/src/bridge-service.ts` | 1216 |
| `resolveFencedRequest` | Method | `packages/core/src/bridge-service.ts` | 1228 |
| `rejectFencedRequest` | Method | `packages/core/src/bridge-service.ts` | 1234 |
| `acknowledgeFencedRequest` | Method | `packages/core/src/bridge-service.ts` | 1240 |
| `clearAllPendingRequests` | Method | `packages/core/src/bridge-service.ts` | 1255 |
| `cancelRequest` | Method | `packages/core/src/bridge-service.ts` | 1265 |
| `requestCancellation` | Method | `packages/core/src/bridge-service.ts` | 1300 |
| `save` | Method | `packages/core/src/request-journal.ts` | 97 |
| `compact` | Method | `packages/core/src/request-journal.ts` | 129 |
| `attachBridgeWebSocket` | Function | `packages/core/src/http-server.ts` | 1052 |
| `deliver` | Function | `packages/core/src/http-server.ts` | 1058 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `AttachBridgeWebSocket → Compact` | intra_community | 5 |
| `AttachBridgeWebSocket → PruneTerminalStatuses` | cross_community | 4 |
| `AttachBridgeWebSocket → IsTerminalRequestState` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Tools | 6 calls |
| Cluster_6 | 3 calls |

## How to Explore

1. `context({name: "journalSnapshot"})` — see callers and callees
2. `query({search_query: "cluster_12"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
