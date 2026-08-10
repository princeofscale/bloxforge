import {
  CapabilityRegistry,
  checkRoundTrip,
  diffRegistries,
  LOSSY_WITHOUT_FULL_SHAPE,
  type ApiDump,
} from '../engine/capability-registry.js';

const dump = (over: Partial<ApiDump> = {}): ApiDump => ({
  Classes: [
    { Name: 'Instance', Members: [
      { Name: 'Name', MemberType: 'Property', ValueType: { Name: 'string' } },
      { Name: 'ClassName', MemberType: 'Property', Tags: ['ReadOnly'], ValueType: { Name: 'string' } },
      { Name: 'Destroy', MemberType: 'Function' },
    ] },
    { Name: 'PVInstance', Superclass: 'Instance', Members: [
      { Name: 'PivotOffset', MemberType: 'Property', ValueType: { Name: 'CFrame' } },
    ] },
    { Name: 'BasePart', Superclass: 'PVInstance', Members: [
      { Name: 'CFrame', MemberType: 'Property', ValueType: { Name: 'CFrame' } },
      { Name: 'Anchored', MemberType: 'Property', ValueType: { Name: 'bool' } },
      { Name: 'Position', MemberType: 'Property', ValueType: { Name: 'Vector3' } },
      { Name: 'BrickColor', MemberType: 'Property', Security: { Read: 'None', Write: 'PluginSecurity' }, ValueType: { Name: 'BrickColor' } },
      { Name: 'archivable', MemberType: 'Property', Security: 'RobloxScriptSecurity', ValueType: { Name: 'bool' } },
    ] },
  ],
  ...over,
});

const studio = (d: ApiDump = dump()) => new CapabilityRegistry(d, { source: 'studio', studioVersion: '0.700' });

describe('construction', () => {
  it('refuses a dump that is not one, rather than behaving as an empty one', () => {
    // An empty registry answers `unknown` to everything, which reads like a
    // cautious result and is actually a parse failure nobody noticed.
    expect(() => new CapabilityRegistry({} as ApiDump, { source: 'fixture' })).toThrow(/no Classes array/);
  });

  it('refuses a dump that declares a class twice', () => {
    const twice = dump({ Classes: [{ Name: 'Part' }, { Name: 'Part' }] });
    expect(() => new CapabilityRegistry(twice, { source: 'fixture' })).toThrow(/declares Part twice/);
  });

  it('names a superclass it cannot resolve instead of quietly rooting the class', () => {
    const orphan = new CapabilityRegistry(dump({ Classes: [{ Name: 'Widget', Superclass: 'Gizmo' }] }), { source: 'fixture' });
    expect(orphan.danglingSuperclasses).toEqual(['Widget -> Gizmo']);
  });

  it('says whether it is authoritative, because only Studio is', () => {
    // A tracker dump describes some Studio, on some day. Treating it as the
    // truth is the same mistake this registry exists to catch.
    expect(studio().authoritative).toBe(true);
    expect(new CapabilityRegistry(dump(), { source: 'tracker' }).authoritative).toBe(false);
  });
});

describe('lookup', () => {
  it('walks the superclass chain to find an inherited member', () => {
    const found = studio().member('BasePart', 'Name');
    expect(found).toMatchObject({ Name: 'Name', declaredOn: 'Instance' });
  });

  it('reports the whole ancestry, nearest first', () => {
    expect(studio().ancestry('BasePart')).toEqual(['BasePart', 'PVInstance', 'Instance']);
  });

  it('returns an empty ancestry for a class it does not have', () => {
    expect(studio().ancestry('Nonexistent')).toEqual([]);
  });

  it('collects inherited properties with the nearest declaration winning', () => {
    const names = studio().properties('BasePart').map((p) => p.Name);
    expect(names).toContain('Anchored');
    expect(names).toContain('Name');
    expect(names).not.toContain('Destroy');
  });
});

describe('canWrite', () => {
  const registry = studio();

  it('allows a plain writable property', () => {
    expect(registry.canWrite('BasePart', 'Anchored')).toEqual({ verdict: 'yes', reasons: [] });
  });

  it('separates "asked and refused" from "cannot answer"', () => {
    // `no` is a reason to stop; `unknown` is a reason to go and look. Collapsing
    // them loses the only useful distinction a registry has.
    expect(registry.canWrite('BasePart', 'ClassName').verdict).toBe('no');
    expect(registry.canWrite('Nonexistent', 'Anchored').verdict).toBe('unknown');
    expect(registry.canWrite('BasePart', 'NoSuchProperty').verdict).toBe('unknown');
  });

  it('refuses a member that is not a property, and says what it is', () => {
    expect(registry.canWrite('BasePart', 'Destroy')).toEqual({ verdict: 'no', reasons: ['BasePart.Destroy is a Function, not a property'] });
  });

  it('reads write security in both shapes the dump uses', () => {
    expect(registry.canWrite('BasePart', 'BrickColor').reasons).toEqual(['write security is PluginSecurity']);
    expect(registry.canWrite('BasePart', 'archivable').reasons).toEqual(['write security is RobloxScriptSecurity']);
  });

  it('does not read writability off a Security object that names no Write', () => {
    const odd = new CapabilityRegistry(dump({
      Classes: [{ Name: 'Thing', Members: [{ Name: 'X', MemberType: 'Property', Security: { Read: 'None' }, ValueType: { Name: 'bool' } }] }],
    }), { source: 'fixture' });
    // Read: None says nothing about writing; falling back to it is how a
    // read-only-to-scripts property looks writable.
    expect(odd.canWrite('Thing', 'X').verdict).toBe('yes');
    expect(odd.canWrite('Thing', 'X').reasons).toEqual([]);
  });
});

describe('checkWrite', () => {
  const registry = studio();

  it('names the expected type when the value does not match', () => {
    // The whole point: `{x,y,z}` is a perfectly good value and a perfectly
    // wrong CFrame, and nothing downstream would have said so.
    const verdict = registry.checkWrite('BasePart', 'CFrame', 'Vector3');
    expect(verdict).toEqual({ allowed: false, verdict: 'no', expectedType: 'CFrame', reasons: ['expects CFrame, got Vector3'] });
  });

  it('allows a matching type', () => {
    expect(registry.checkWrite('BasePart', 'Position', 'Vector3').allowed).toBe(true);
  });

  it('reports the expected type even when the caller did not name one', () => {
    expect(registry.checkWrite('BasePart', 'Position')).toEqual({ allowed: true, verdict: 'yes', expectedType: 'Vector3', reasons: [] });
  });

  it('refuses rather than allows when the dump declares no value type', () => {
    const untyped = new CapabilityRegistry(dump({
      Classes: [{ Name: 'Thing', Members: [{ Name: 'X', MemberType: 'Property' }] }],
    }), { source: 'fixture' });
    expect(untyped.checkWrite('Thing', 'X', 'bool')).toMatchObject({ allowed: false, verdict: 'unknown' });
  });

  it('carries a write refusal through instead of type-checking a property nobody may set', () => {
    expect(registry.checkWrite('BasePart', 'ClassName', 'string')).toMatchObject({ allowed: false, verdict: 'no' });
  });
});

describe('round-trip safety', () => {
  const registry = studio();

  it('names CFrame as lossy, which is the bug this list came from', () => {
    const verdict = checkRoundTrip(registry, 'BasePart', 'CFrame');
    expect(verdict.safe).toBe(false);
    expect(verdict.note).toMatch(/silently discards the orientation/);
  });

  it('passes a type that a flat value carries whole', () => {
    expect(checkRoundTrip(registry, 'BasePart', 'Anchored')).toEqual({ safe: true, verdict: 'yes', expectedType: 'bool' });
  });

  it('says unknown for a property it has never heard of rather than assuming it is fine', () => {
    // A serializer that assumes it round-trips whatever it does not recognise
    // is exactly how the rotation went missing.
    expect(checkRoundTrip(registry, 'BasePart', 'Invented')).toMatchObject({ safe: false, verdict: 'unknown' });
  });

  it('covers the inherited CFrame too, not only the one declared here', () => {
    expect(checkRoundTrip(registry, 'BasePart', 'PivotOffset').safe).toBe(false);
  });

  it('explains every type on the lossy list', () => {
    for (const [type, why] of Object.entries(LOSSY_WITHOUT_FULL_SHAPE)) {
      expect(why.length).toBeGreaterThan(10);
      expect(type).not.toBe('');
    }
  });
});

describe('diffing two dumps', () => {
  const before = studio();

  it('calls a pure addition compatible', () => {
    const after = studio(dump({
      Classes: [...dump().Classes, { Name: 'NewThing', Superclass: 'Instance' }],
    }));
    const diff = diffRegistries(before, after);
    expect(diff.addedClasses).toEqual(['NewThing']);
    expect(diff.compatible).toBe(true);
  });

  it('fails a removal, which breaks a caller that still type-checks', () => {
    const classes = dump().Classes.map((c) => (
      c.Name === 'BasePart' ? { ...c, Members: c.Members!.filter((m) => m.Name !== 'Anchored') } : c
    ));
    const diff = diffRegistries(before, studio(dump({ Classes: classes })));
    expect(diff.removedMembers).toEqual(['BasePart.Anchored']);
    expect(diff.compatible).toBe(false);
  });

  it('catches a changed type, the one that breaks nothing until it runs', () => {
    const classes = dump().Classes.map((c) => (
      c.Name === 'BasePart'
        ? { ...c, Members: c.Members!.map((m) => (m.Name === 'Position' ? { ...m, ValueType: { Name: 'Vector3int16' } } : m)) }
        : c
    ));
    const diff = diffRegistries(before, studio(dump({ Classes: classes })));
    expect(diff.changedTypes).toEqual([{ member: 'BasePart.Position', from: 'Vector3', to: 'Vector3int16' }]);
    expect(diff.compatible).toBe(false);
  });

  it('reports a newly deprecated member without failing on it', () => {
    const classes = dump().Classes.map((c) => (
      c.Name === 'BasePart'
        ? { ...c, Members: c.Members!.map((m) => (m.Name === 'Anchored' ? { ...m, Tags: ['Deprecated'] } : m)) }
        : c
    ));
    const diff = diffRegistries(before, studio(dump({ Classes: classes })));
    expect(diff.newlyDeprecated).toEqual(['BasePart.Anchored']);
    // Deprecated still works. It is a warning about next year, not this build.
    expect(diff.compatible).toBe(true);
  });

  it('fails a member that gained write security', () => {
    const classes = dump().Classes.map((c) => (
      c.Name === 'BasePart'
        ? { ...c, Members: c.Members!.map((m) => (m.Name === 'Anchored' ? { ...m, Security: { Write: 'PluginSecurity' } } : m)) }
        : c
    ));
    const diff = diffRegistries(before, studio(dump({ Classes: classes })));
    expect(diff.newlySecured).toEqual([{ member: 'BasePart.Anchored', from: 'None', to: 'PluginSecurity' }]);
    expect(diff.compatible).toBe(false);
  });

  it('does not confuse an inherited member with a removed one', () => {
    // `Name` lives on Instance. Comparing BasePart's own members only is what
    // keeps a superclass reshuffle from reading as a mass deletion.
    const diff = diffRegistries(before, studio());
    expect(diff.removedMembers).toEqual([]);
    expect(diff.compatible).toBe(true);
  });
});
