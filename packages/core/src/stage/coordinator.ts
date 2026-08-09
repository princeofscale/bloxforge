// The stage coordinator: snapshot, apply, verify, and roll back if needed.
//
// Roadmap D3. The eight steps are given in a specific order and the order *is*
// the safety property, so it is encoded as a state machine that refuses to skip
// one rather than as a documented procedure someone follows. Two of the
// orderings are not stylistic:
//
// - the snapshot is serialized **before** the recorded write opens, because a
//   ChangeHistoryService recording cannot safely span an await. Held open
//   across a yield it blocks the user's own edits and can be left dangling when
//   the job is cancelled — which is why `/api/execute-luau-async` is already a
//   declared exception in the undo-coverage audit.
// - the live reread and baseline digest happen before the snapshot, so the
//   snapshot is known to correspond to a state we measured rather than to
//   whatever the scene happened to be when serialization got round to it.
//
// The snapshot itself never enters model context. It is bytes on disk with a
// size and a hash; a base64 place dump in a conversation is both useless to the
// model and enormous.

export type StagePhase =
  | 'prepared'
  | 'baselined'
  | 'snapshotted'
  | 'applied'
  | 'verified'
  | 'failed'
  | 'rolled-back';

export class StageOrderError extends Error {
  constructor(readonly attempted: string, readonly phase: StagePhase, message: string) {
    super(message);
    this.name = 'StageOrderError';
  }
}

export class StageDigestError extends Error {}

export interface SnapshotHandle {
  /** Where the bytes are. Never the bytes themselves. */
  uri: string;
  hash: string;
  bytes: number;
}

export interface StageEvidence {
  planHash: string;
  baselineDigest: string;
  snapshot?: SnapshotHandle;
  postDigest?: string;
  restoredDigest?: string;
  gates?: { id: string; result: 'passed' | 'failed' | 'unknown' }[];
}

/**
 * A rollback is a new plan, not a privileged undo.
 *
 * It carries the digest it expects the scene to be at, so restoring cannot
 * silently overwrite work someone did after the failure. A stale digest stops
 * the restore and asks — the roadmap is explicit that rollback does not get to
 * bypass the invariants the forward path is held to.
 */
export interface RollbackPlan {
  kind: 'rollback';
  snapshot: SnapshotHandle;
  expectedCurrentDigest: string;
  reason: string;
}

export class StageCoordinator {
  private phase: StagePhase = 'prepared';
  private evidence: StageEvidence;

  constructor(planHash: string, private readonly contract: string) {
    if (!planHash) throw new StageDigestError('a stage needs a planHash before anything else');
    this.evidence = { planHash, baselineDigest: '' };
  }

  get currentPhase(): StagePhase {
    return this.phase;
  }

  private require(attempted: string, allowed: readonly StagePhase[]): void {
    if (!allowed.includes(this.phase)) {
      throw new StageOrderError(
        attempted,
        this.phase,
        `cannot ${attempted} from ${this.phase}; expected one of ${allowed.join(', ')}`,
      );
    }
  }

  /** Step 2: live reread, before anything is captured or written. */
  recordBaseline(digest: string): void {
    this.require('record a baseline', ['prepared']);
    if (!digest) throw new StageDigestError('the baseline digest must not be empty');
    this.evidence.baselineDigest = digest;
    this.phase = 'baselined';
  }

  /** Step 3-4: the snapshot, taken before any recorded write opens. */
  recordSnapshot(handle: SnapshotHandle): void {
    this.require('record a snapshot', ['baselined']);
    if (!handle.hash || handle.bytes <= 0) {
      // A zero-byte or unhashed snapshot is not a rollback target. Accepting it
      // would give the failure path something to restore from that restores
      // nothing, and report success for doing so.
      throw new StageDigestError('a snapshot needs a hash and a non-zero size to be a rollback target');
    }
    this.evidence.snapshot = handle;
    this.phase = 'snapshotted';
  }

  /**
   * Step 5: the bounded, recorded write.
   *
   * Refused without a snapshot. The whole coordinator exists so that a failed
   * apply has somewhere to go back to, and an apply that runs without one has
   * quietly opted out of that.
   */
  beginApply(): void {
    this.require('begin the apply', ['snapshotted']);
    this.phase = 'applied';
  }

  /** Step 6: live reread, post digest, deterministic gates. */
  recordOutcome(postDigest: string, gates: { id: string; result: 'passed' | 'failed' | 'unknown' }[]): boolean {
    this.require('record an outcome', ['applied']);
    if (!postDigest) throw new StageDigestError('the post digest must not be empty');
    this.evidence.postDigest = postDigest;
    this.evidence.gates = gates;
    // `unknown` is not a pass here either: a gate that could not be evaluated
    // leaves the stage in the state the rollback path exists for.
    const ok = gates.length > 0 && gates.every((g) => g.result === 'passed');
    this.phase = ok ? 'verified' : 'failed';
    return ok;
  }

  /** Step 7: build the rollback as a plan, with the digest it expects to find. */
  planRollback(observedDigest: string, reason: string): RollbackPlan {
    this.require('plan a rollback', ['failed', 'applied']);
    const snapshot = this.evidence.snapshot;
    if (!snapshot) throw new StageDigestError('there is no snapshot to roll back to');
    if (!observedDigest) throw new StageDigestError('a rollback needs the digest it expects to find');
    return { kind: 'rollback', snapshot, expectedCurrentDigest: observedDigest, reason };
  }

  /**
   * Step 8: verify the restore actually restored, and refuse a stale one.
   *
   * The stale check is the reason a rollback is a plan rather than an undo. If
   * the scene moved between planning the rollback and running it, restoring
   * would overwrite whatever moved it — most likely a person reacting to the
   * same failure.
   */
  completeRollback(currentDigest: string, plan: RollbackPlan, restoredDigest: string): void {
    this.require('complete a rollback', ['failed', 'applied']);
    if (currentDigest !== plan.expectedCurrentDigest) {
      throw new StageDigestError(
        'the scene changed between planning the rollback and running it — restoring now would overwrite that change, so this needs a human decision',
      );
    }
    if (restoredDigest !== this.evidence.baselineDigest) {
      throw new StageDigestError(
        `rollback did not restore the baseline: expected ${this.evidence.baselineDigest}, got ${restoredDigest}`,
      );
    }
    this.evidence.restoredDigest = restoredDigest;
    this.phase = 'rolled-back';
  }

  /** Everything retained, tied to the planHash and the digests it ran under. */
  finish(): StageEvidence & { contract: string; phase: StagePhase } {
    if (this.phase !== 'verified' && this.phase !== 'rolled-back') {
      throw new StageOrderError('finish', this.phase, `a stage in ${this.phase} is neither verified nor rolled back`);
    }
    return { ...this.evidence, contract: this.contract, phase: this.phase };
  }
}
