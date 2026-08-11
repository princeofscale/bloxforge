import { LOSSY_WITHOUT_FULL_SHAPE } from '../engine/capability-registry.js';
import { buildNodeBatchLuau, STRUCTURED_VALUE_TYPES } from '../builders/world-model.js';

describe('the lossy list and the serializer', () => {
  it('handles every type the capability registry calls lossy', () => {
    // The list is a guard only if something consults it. CFrame was on it once,
    // and losing its rotation was silent precisely because nothing did.
    const structured = new Set(STRUCTURED_VALUE_TYPES);
    const unhandled = Object.keys(LOSSY_WITHOUT_FULL_SHAPE).filter((type) => !structured.has(type));
    expect(unhandled).toEqual([]);
  });

  it('emits a branch for each type it claims to structure', () => {
    const luau = buildNodeBatchLuau(['game.Workspace']);
    for (const type of STRUCTURED_VALUE_TYPES) {
      expect(luau).toContain(`== "${type}"`);
    }
  });

  it('names what it could not structure instead of returning a bare string', () => {
    // An opaque blob that looks like a value is how a caller writes back
    // something that is not what it read.
    expect(buildNodeBatchLuau(['game.Workspace'])).toMatch(/__opaque = tostring\(v\), __type = t/);
  });
});
