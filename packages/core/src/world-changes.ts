// Pure diff + bounded store for get_changes_since. A fingerprint maps full path ->
// "ClassName|childCount". Diffing two fingerprints yields the added/removed/changed
// paths so an agent can refresh only what moved instead of re-pulling the world.

export type Fingerprint = Record<string, string>;

export interface FingerprintDiff {
	added: string[];
	removed: string[];
	changed: string[];
	addedCount: number;
	removedCount: number;
	changedCount: number;
}

/** Diff a previous fingerprint against the current one. */
export function diffFingerprints(prev: Fingerprint, curr: Fingerprint): FingerprintDiff {
	const added: string[] = [];
	const removed: string[] = [];
	const changed: string[] = [];
	for (const path of Object.keys(curr)) {
		if (!(path in prev)) added.push(path);
		else if (prev[path] !== curr[path]) changed.push(path);
	}
	for (const path of Object.keys(prev)) {
		if (!(path in curr)) removed.push(path);
	}
	added.sort();
	removed.sort();
	changed.sort();
	return {
		added,
		removed,
		changed,
		addedCount: added.length,
		removedCount: removed.length,
		changedCount: changed.length,
	};
}

interface StoredSnapshot {
	id: string;
	path: string;
	fingerprint: Fingerprint;
	createdAt: number;
}

/** Bounded in-memory snapshot store keyed by snapshotId. */
export class SnapshotStore {
	private readonly snapshots = new Map<string, StoredSnapshot>();
	private readonly maxSnapshots: number;
	private seq = 0;

	constructor(maxSnapshots = 20) {
		this.maxSnapshots = maxSnapshots;
	}

	private newId(): string {
		this.seq += 1;
		return `snap_${Date.now().toString(36)}_${this.seq}`;
	}

	put(path: string, fingerprint: Fingerprint): string {
		const id = this.newId();
		this.snapshots.set(id, { id, path, fingerprint, createdAt: Date.now() });
		this.prune();
		return id;
	}

	get(id: string): StoredSnapshot | undefined {
		return this.snapshots.get(id);
	}

	/** Replace a stored snapshot's fingerprint in place (rolling baseline). */
	update(id: string, fingerprint: Fingerprint): void {
		const snap = this.snapshots.get(id);
		if (snap) snap.fingerprint = fingerprint;
	}

	private prune(): void {
		if (this.snapshots.size <= this.maxSnapshots) return;
		// Drop the oldest by insertion order (Map preserves it).
		const overflow = this.snapshots.size - this.maxSnapshots;
		let removed = 0;
		for (const key of this.snapshots.keys()) {
			if (removed >= overflow) break;
			this.snapshots.delete(key);
			removed += 1;
		}
	}
}
