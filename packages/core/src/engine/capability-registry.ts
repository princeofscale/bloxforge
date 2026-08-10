// What this Studio can actually do, as a thing you can ask rather than assume.
//
// Roadmap 04, item 3. The failure it exists to prevent is not "we called a
// method that does not exist" — that one announces itself. It is the quieter
// shape: **the property exists, and its type is not what we thought.** That is
// how rotation went missing from a serialized `CFrame`: nothing errored, the
// write succeeded, and the part came back facing the wrong way.
//
// Two rules about where the answers come from:
//
// 1. **The authority is the Studio in front of us.** A dump from a tracking
//    repository describes some Studio, on some day. Using it as the truth is
//    the same category of mistake this file exists to catch.
// 2. **An unknown class is not a permissive one.** Every query that cannot be
//    answered says `unknown`, and every gate treats `unknown` as a refusal.
//    A registry that shrugs and returns `yes` is worse than no registry.

export type Tri = 'yes' | 'no' | 'unknown';

/** The subset of Roblox's API dump this needs. Extra fields are ignored, never rejected. */
export interface ApiDump {
  Classes: ApiClass[];
  Enums?: { Name: string; Items?: { Name: string; Value: number }[] }[];
  Version?: number;
}

export interface ApiClass {
  Name: string;
  Superclass?: string;
  Tags?: string[];
  Members?: ApiMember[];
}

export interface ApiMember {
  Name: string;
  MemberType: 'Property' | 'Function' | 'Event' | 'Callback' | string;
  Tags?: string[];
  /** Either `"None"` or `{ Read, Write }`. Both shapes are real; both are handled. */
  Security?: string | { Read?: string; Write?: string };
  ValueType?: { Category?: string; Name?: string };
  Serialization?: { CanLoad?: boolean; CanSave?: boolean };
}

export interface RegistryOrigin {
  /** Where this dump came from. `'studio'` is the only authoritative one. */
  source: 'studio' | 'tracker' | 'fixture';
  /** The Studio build the dump describes, when it is known. */
  studioVersion?: string;
  capturedAt?: number;
}

export interface ResolvedMember extends ApiMember {
  /** The class the member is actually declared on, which may be an ancestor. */
  declaredOn: string;
}

const READ_ONLY_TAGS = new Set(['ReadOnly', 'Deprecated', 'NotScriptable', 'Hidden']);

export class CapabilityRegistry {
  private readonly classes = new Map<string, ApiClass>();
  readonly origin: RegistryOrigin;
  /** Classes whose declared superclass is not in this dump. Named, not silently rooted. */
  readonly danglingSuperclasses: readonly string[];

  constructor(dump: ApiDump, origin: RegistryOrigin) {
    if (!dump || !Array.isArray(dump.Classes)) {
      throw new Error('API dump has no Classes array. A dump that does not parse is not a dump with defaults.');
    }
    for (const cls of dump.Classes) {
      if (!cls?.Name) continue;
      if (this.classes.has(cls.Name)) {
        throw new Error(`API dump declares ${cls.Name} twice; which one wins is not something to guess at.`);
      }
      this.classes.set(cls.Name, cls);
    }
    this.origin = origin;
    this.danglingSuperclasses = [...this.classes.values()]
      .filter((c) => c.Superclass && c.Superclass !== '<<<ROOT>>>' && !this.classes.has(c.Superclass))
      .map((c) => `${c.Name} -> ${c.Superclass}`)
      .sort();
  }

  get classCount(): number {
    return this.classes.size;
  }

  get authoritative(): boolean {
    return this.origin.source === 'studio';
  }

  hasClass(name: string): boolean {
    return this.classes.has(name);
  }

  /** Class names, sorted. */
  classNames(): string[] {
    return [...this.classes.keys()].sort();
  }

  /** Members declared on this class itself, not inherited. Used by the diff. */
  ownMembers(className: string): readonly ApiMember[] {
    return this.classes.get(className)?.Members ?? [];
  }

  /** A class and every ancestor, nearest first. Empty when the class is unknown. */
  ancestry(className: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = className;
    while (current && this.classes.has(current) && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      current = this.classes.get(current)!.Superclass;
    }
    return chain;
  }

  /** Find a member on the class or the nearest ancestor that declares it. */
  member(className: string, memberName: string): ResolvedMember | undefined {
    for (const name of this.ancestry(className)) {
      const found = this.classes.get(name)!.Members?.find((m) => m.Name === memberName);
      if (found) return { ...found, declaredOn: name };
    }
    return undefined;
  }

  /**
   * Whether a property can be written from a script, and why not when it cannot.
   *
   * An unknown class or an unknown member is `unknown`, not `no`: the two mean
   * different things to a caller. `no` says "asked and refused"; `unknown` says
   * "this registry cannot answer", which is a reason to go and look rather than
   * a reason to give up.
   */
  canWrite(className: string, propertyName: string): { verdict: Tri; reasons: string[] } {
    if (!this.hasClass(className)) return { verdict: 'unknown', reasons: [`${className} is not in this dump`] };
    const found = this.member(className, propertyName);
    if (!found) return { verdict: 'unknown', reasons: [`${className}.${propertyName} is not in this dump`] };
    if (found.MemberType !== 'Property') {
      return { verdict: 'no', reasons: [`${className}.${propertyName} is a ${found.MemberType}, not a property`] };
    }

    const reasons: string[] = [];
    for (const tag of found.Tags ?? []) {
      if (READ_ONLY_TAGS.has(tag)) reasons.push(`tagged ${tag}`);
    }
    const write = writeSecurityOf(found);
    if (write !== 'None') reasons.push(`write security is ${write}`);
    return { verdict: reasons.length === 0 ? 'yes' : 'no', reasons };
  }

  /**
   * Whether a value of this shape may be assigned to the property.
   *
   * The type check is by declared name, and a mismatch is reported rather than
   * coerced. This is the `CFrame` case: `{x, y, z}` is a perfectly good value
   * and a perfectly wrong CFrame, and nothing downstream would have said so.
   */
  checkWrite(className: string, propertyName: string, valueTypeName?: string): {
    allowed: boolean;
    verdict: Tri;
    expectedType?: string;
    reasons: string[];
  } {
    const write = this.canWrite(className, propertyName);
    if (write.verdict !== 'yes') return { allowed: false, verdict: write.verdict, reasons: write.reasons };

    const expected = this.member(className, propertyName)?.ValueType?.Name;
    if (!expected) {
      return { allowed: false, verdict: 'unknown', reasons: [`${className}.${propertyName} declares no value type in this dump`] };
    }
    if (valueTypeName === undefined) {
      return { allowed: true, verdict: 'yes', expectedType: expected, reasons: [] };
    }
    return valueTypeName === expected
      ? { allowed: true, verdict: 'yes', expectedType: expected, reasons: [] }
      : { allowed: false, verdict: 'no', expectedType: expected, reasons: [`expects ${expected}, got ${valueTypeName}`] };
  }

  /** Every property of a class and its ancestors, nearest declaration winning. */
  properties(className: string): ResolvedMember[] {
    const byName = new Map<string, ResolvedMember>();
    for (const name of this.ancestry(className)) {
      for (const m of this.classes.get(name)!.Members ?? []) {
        if (m.MemberType === 'Property' && !byName.has(m.Name)) byName.set(m.Name, { ...m, declaredOn: name });
      }
    }
    return [...byName.values()].sort((a, b) => a.Name.localeCompare(b.Name));
  }
}

function writeSecurityOf(member: ApiMember): string {
  const security = member.Security;
  if (security === undefined) return 'None';
  if (typeof security === 'string') return security;
  // An object that names no Write is not an object that permits writing.
  return security.Write ?? security.Read ?? 'Unknown';
}

// ─── Round-trip safety ───────────────────────────────────────────────

/**
 * Types that do not survive being written as a flat `{x, y, z}`-shaped object.
 *
 * This is the list the `CFrame` bug belongs to. Each of these carries more than
 * a position: dropping the rest is silent, because the truncated value is still
 * a valid value of a *different* thing.
 */
export const LOSSY_WITHOUT_FULL_SHAPE: Readonly<Record<string, string>> = {
  CFrame: 'position plus a 3x3 rotation; a {x,y,z} carries the position and silently discards the orientation',
  Ray: 'origin and direction; either alone is a different ray',
  Region3: 'two corners; one corner is a point',
  NumberSequence: 'keypoints with envelopes; a single number is the value at time zero only',
  ColorSequence: 'keypoints; a single Color3 is the value at time zero only',
  NumberRange: 'min and max; a single number collapses the range',
  PhysicalProperties: 'density, friction, elasticity and their weights',
  Faces: 'six independent booleans',
  Axes: 'three independent booleans',
};

export interface RoundTripVerdict {
  safe: boolean;
  verdict: Tri;
  expectedType?: string;
  note?: string;
}

/**
 * Whether reading this property and writing it back preserves it.
 *
 * `unknown` for a property the registry has never heard of — which is the point.
 * A serializer that assumes it round-trips everything it does not recognise is
 * exactly how the rotation went missing.
 */
export function checkRoundTrip(registry: CapabilityRegistry, className: string, propertyName: string): RoundTripVerdict {
  const found = registry.member(className, propertyName);
  if (!found) return { safe: false, verdict: 'unknown', note: `${className}.${propertyName} is not in this dump` };
  const type = found.ValueType?.Name;
  if (!type) return { safe: false, verdict: 'unknown', expectedType: undefined, note: 'no declared value type' };
  const lossy = LOSSY_WITHOUT_FULL_SHAPE[type];
  return lossy
    ? { safe: false, verdict: 'no', expectedType: type, note: `${type} is ${lossy}` }
    : { safe: true, verdict: 'yes', expectedType: type };
}

// ─── Diffing two dumps ───────────────────────────────────────────────

export interface RegistryDiff {
  removedClasses: string[];
  addedClasses: string[];
  removedMembers: string[];
  addedMembers: string[];
  /** A member whose declared type changed. The one that breaks code that still compiles. */
  changedTypes: { member: string; from: string; to: string }[];
  newlyDeprecated: string[];
  newlySecured: { member: string; from: string; to: string }[];
  /** True when nothing here can break an existing caller. */
  compatible: boolean;
}

/**
 * What changed between two dumps, for the weekly feed.
 *
 * `addedClasses` and `addedMembers` are reported but do not make a diff
 * incompatible — nothing that exists stopped existing. Everything else can
 * break a caller that still type-checks, which is the category worth a CI
 * failure rather than a note.
 */
export function diffRegistries(before: CapabilityRegistry, after: CapabilityRegistry): RegistryDiff {
  const diff: RegistryDiff = {
    removedClasses: [], addedClasses: [], removedMembers: [], addedMembers: [],
    changedTypes: [], newlyDeprecated: [], newlySecured: [], compatible: true,
  };

  const beforeClasses = new Set(before.classNames());
  const afterClasses = new Set(after.classNames());
  diff.removedClasses = [...beforeClasses].filter((c) => !afterClasses.has(c)).sort();
  diff.addedClasses = [...afterClasses].filter((c) => !beforeClasses.has(c)).sort();

  for (const className of before.classNames()) {
    if (!afterClasses.has(className)) continue;
    const was = new Map(before.ownMembers(className).map((m) => [m.Name, m]));
    const now = new Map(after.ownMembers(className).map((m) => [m.Name, m]));

    for (const [name, member] of was) {
      const qualified = `${className}.${name}`;
      const current = now.get(name);
      if (!current) {
        diff.removedMembers.push(qualified);
        continue;
      }
      const from = member.ValueType?.Name;
      const to = current.ValueType?.Name;
      if (from && to && from !== to) diff.changedTypes.push({ member: qualified, from, to });
      if (!(member.Tags ?? []).includes('Deprecated') && (current.Tags ?? []).includes('Deprecated')) {
        diff.newlyDeprecated.push(qualified);
      }
      const wasSecurity = writeSecurityOf(member);
      const nowSecurity = writeSecurityOf(current);
      if (wasSecurity === 'None' && nowSecurity !== 'None') {
        diff.newlySecured.push({ member: qualified, from: wasSecurity, to: nowSecurity });
      }
    }
    for (const name of now.keys()) {
      if (!was.has(name)) diff.addedMembers.push(`${className}.${name}`);
    }
  }

  for (const key of ['removedMembers', 'addedMembers', 'newlyDeprecated'] as const) diff[key].sort();
  diff.compatible = diff.removedClasses.length === 0
    && diff.removedMembers.length === 0
    && diff.changedTypes.length === 0
    && diff.newlySecured.length === 0;
  return diff;
}
