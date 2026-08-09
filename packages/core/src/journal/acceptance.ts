// The stage acceptance contract.
//
// Roadmap D2. A stage is done only when every required predicate passed, no
// hard invariant came back `unknown`, and the evidence is tied to the planHash
// and revision it was gathered under.
//
// The `unknown` rule is the whole point and the easiest thing to get wrong. A
// gate that could not be evaluated is not a gate that passed. Every audit this
// repository has had to repair failed the same way — reporting success for
// something it never examined — and an acceptance contract is where that
// mistake costs the most, because it is the thing that says "ship it".

export type GateResult = 'passed' | 'failed' | 'unknown';

export interface Gate {
  id: string;
  /**
   * A hard invariant cannot be satisfied by an `unknown`. A soft one may be:
   * a vision rubric that could not be rendered is a missing opinion, not a
   * violated rule.
   */
  hard: boolean;
  result: GateResult;
  detail?: string;
}

export interface AcceptanceContract {
  contract: string;
  preconditions: { revision: number; baselineDigest: string };
  planHash: string;
  gates: Gate[];
  /** What was retained, and what it was retained against. */
  evidence: { retain: string[]; planHash?: string; revision?: number };
}

export interface AcceptanceVerdict {
  passed: boolean;
  reasons: string[];
  counts: { passed: number; failed: number; unknown: number; hardUnknown: number };
}

export interface ObservedState {
  revision: number;
  baselineDigest: string;
}

/**
 * Evaluate a contract against the state it was written for.
 *
 * Preconditions are checked first and separately: a contract evaluated against
 * a different revision than it was written for is not a failing contract, it is
 * an inapplicable one, and reporting "failed" would send someone hunting for a
 * defect that is not there.
 */
export function evaluateAcceptance(contract: AcceptanceContract, observed: ObservedState): AcceptanceVerdict {
  const reasons: string[] = [];

  if (observed.revision !== contract.preconditions.revision) {
    reasons.push(
      `contract was written for revision ${contract.preconditions.revision}, the place is at ${observed.revision}`,
    );
  }
  if (observed.baselineDigest !== contract.preconditions.baselineDigest) {
    reasons.push('baseline digest does not match the one the contract was written against');
  }

  const counts = { passed: 0, failed: 0, unknown: 0, hardUnknown: 0 };
  for (const gate of contract.gates) {
    if (gate.result === 'passed') counts.passed++;
    else if (gate.result === 'failed') {
      counts.failed++;
      reasons.push(`${gate.id} failed${gate.detail ? `: ${gate.detail}` : ''}`);
    } else {
      counts.unknown++;
      if (gate.hard) {
        counts.hardUnknown++;
        // Named differently from a failure on purpose. "Could not be evaluated"
        // and "was evaluated and was wrong" lead to different next actions, and
        // collapsing them is how an unrunnable check becomes a permanent pass.
        reasons.push(`${gate.id} could not be evaluated and is a hard invariant${gate.detail ? `: ${gate.detail}` : ''}`);
      }
    }
  }

  if (contract.evidence.planHash !== undefined && contract.evidence.planHash !== contract.planHash) {
    reasons.push('evidence was gathered against a different planHash than the contract names');
  }
  if (contract.evidence.revision !== undefined && contract.evidence.revision !== contract.preconditions.revision) {
    reasons.push('evidence was gathered at a different revision than the contract names');
  }
  if (contract.gates.length === 0) {
    // An empty contract passes vacuously, which is the failure shape this file
    // exists to refuse. A stage with nothing to check has not been specified.
    reasons.push('the contract declares no gates, so it cannot be satisfied');
  }

  return { passed: reasons.length === 0, reasons, counts };
}
