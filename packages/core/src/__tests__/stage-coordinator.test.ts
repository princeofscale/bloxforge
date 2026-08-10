import {
  StageCoordinator,
  StageDigestError,
  StageOrderError,
} from '../stage/coordinator.js';

const snapshot = { uri: 'bloxforge://snapshots/s1', hash: 'sha256:snap', bytes: 4096 };
const passing = [{ id: 'expected_values_match', result: 'passed' as const }];

const upToApply = () => {
  const stage = new StageCoordinator('sha256:plan', 'env@1');
  stage.recordBaseline('sha256:base');
  stage.recordSnapshot(snapshot);
  stage.beginApply();
  return stage;
};

describe('StageCoordinator ordering', () => {
  it('walks the happy path and retains evidence tied to the plan', () => {
    const stage = upToApply();
    expect(stage.recordOutcome('sha256:after', passing)).toBe(true);
    const evidence = stage.finish();
    expect(evidence.phase).toBe('verified');
    expect(evidence.planHash).toBe('sha256:plan');
    expect(evidence.baselineDigest).toBe('sha256:base');
    expect(evidence.snapshot).toEqual(snapshot);
    expect(evidence.postDigest).toBe('sha256:after');
  });

  it('refuses an apply that has no snapshot to fall back to', () => {
    const stage = new StageCoordinator('sha256:plan', 'env@1');
    stage.recordBaseline('sha256:base');
    // The coordinator exists so a failed apply has somewhere to go back to. An
    // apply without a snapshot has quietly opted out of that.
    expect(() => stage.beginApply()).toThrow(StageOrderError);
  });

  it('refuses to snapshot before the baseline is measured', () => {
    const stage = new StageCoordinator('sha256:plan', 'env@1');
    // Otherwise the snapshot corresponds to whatever the scene was when
    // serialization got round to it, not to a state anyone measured.
    expect(() => stage.recordSnapshot(snapshot)).toThrow(/cannot record a snapshot from prepared/);
  });

  it('refuses a snapshot that could not restore anything', () => {
    const stage = new StageCoordinator('sha256:plan', 'env@1');
    stage.recordBaseline('sha256:base');
    expect(() => stage.recordSnapshot({ ...snapshot, bytes: 0 })).toThrow(StageDigestError);
    expect(() => stage.recordSnapshot({ ...snapshot, hash: '' })).toThrow(StageDigestError);
  });

  it('refuses to finish a stage that is neither verified nor rolled back', () => {
    const stage = upToApply();
    expect(() => stage.finish()).toThrow(/neither verified nor rolled back/);
  });

  it('names what was attempted and from where', () => {
    const stage = new StageCoordinator('sha256:plan', 'env@1');
    try {
      stage.beginApply();
    } catch (error) {
      expect((error as StageOrderError).attempted).toBe('begin the apply');
      expect((error as StageOrderError).phase).toBe('prepared');
    }
  });
});

describe('StageCoordinator outcomes', () => {
  it('treats an unknown gate as not passing', () => {
    const stage = upToApply();
    // A gate that could not be evaluated leaves the stage in exactly the state
    // the rollback path exists for.
    expect(stage.recordOutcome('sha256:after', [{ id: 'route_reachable', result: 'unknown' }])).toBe(false);
    expect(stage.currentPhase).toBe('failed');
  });

  it('does not let an empty gate list pass vacuously', () => {
    const stage = upToApply();
    expect(stage.recordOutcome('sha256:after', [])).toBe(false);
  });

  it('a failed gate fails the stage', () => {
    const stage = upToApply();
    expect(stage.recordOutcome('sha256:after', [{ id: 'unanchored', result: 'failed' }])).toBe(false);
    expect(stage.currentPhase).toBe('failed');
  });
});

describe('rollback', () => {
  const failedStage = () => {
    const stage = upToApply();
    stage.recordOutcome('sha256:after', [{ id: 'unanchored', result: 'failed' }]);
    return stage;
  };

  it('is a plan carrying the digest it expects to find', () => {
    const plan = failedStage().planRollback('sha256:after', 'unanchored scenery');
    expect(plan).toEqual({
      kind: 'rollback',
      snapshot,
      expectedCurrentDigest: 'sha256:after',
      reason: 'unanchored scenery',
    });
  });

  it('completes when the scene is where the plan expected and the baseline comes back', () => {
    const stage = failedStage();
    const plan = stage.planRollback('sha256:after', 'unanchored scenery');
    stage.completeRollback('sha256:after', plan, 'sha256:base');
    expect(stage.currentPhase).toBe('rolled-back');
    expect(stage.finish().restoredDigest).toBe('sha256:base');
  });

  it('stops when the scene moved between planning and running the rollback', () => {
    const stage = failedStage();
    const plan = stage.planRollback('sha256:after', 'unanchored scenery');
    // Most likely a person reacting to the same failure. Restoring over them is
    // the thing an undo would do and a plan must not.
    expect(() => stage.completeRollback('sha256:someone-else-edited', plan, 'sha256:base'))
      .toThrow(/needs a human decision/);
    expect(stage.currentPhase).toBe('failed');
  });

  it('refuses to call a restore done when the baseline did not come back', () => {
    const stage = failedStage();
    const plan = stage.planRollback('sha256:after', 'unanchored scenery');
    expect(() => stage.completeRollback('sha256:after', plan, 'sha256:something-else'))
      .toThrow(/did not restore the baseline/);
  });

  it('cannot be planned without a snapshot or an expected digest', () => {
    const stage = new StageCoordinator('sha256:plan', 'env@1');
    stage.recordBaseline('sha256:base');
    expect(() => stage.planRollback('sha256:after', 'x')).toThrow(StageOrderError);

    const applied = failedStage();
    expect(() => applied.planRollback('', 'x')).toThrow(/expects to find/);
  });

  it('cannot be planned from a verified stage', () => {
    const stage = upToApply();
    stage.recordOutcome('sha256:after', passing);
    expect(() => stage.planRollback('sha256:after', 'x')).toThrow(StageOrderError);
  });
});
