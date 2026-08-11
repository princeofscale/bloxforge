import {
  generateNative,
  UNRELIABLE_PAYLOAD_BUDGET_BYTES,
  validateSurface,
  type NetworkMessage,
  type NetworkSurface,
} from '../network/ir.js';

const buy = (over: Partial<NetworkMessage> = {}): NetworkMessage => ({
  id: 'BuyItem',
  direction: 'client-to-server',
  kind: 'event',
  reliable: true,
  args: [
    { name: 'itemId', type: 'string', maxLength: 64 },
    { name: 'count', type: 'integer', range: { min: 1, max: 99 } },
  ],
  rateLimit: { perSecond: 4, burst: 8 },
  permission: { policy: 'anyone', rationale: 'any player may buy from the shop' },
  ...over,
});

const surfaceOf = (messages: NetworkMessage[], folder = 'Net'): NetworkSurface => ({ folder, messages });
const rules = (s: NetworkSurface) => validateSurface(s).issues.map((i) => i.rule);

describe('the two decisions a hand-made RemoteEvent never records', () => {
  it('refuses client traffic with no rate limit', () => {
    // Not a performance note. A client can fire a remote in a loop, and that is
    // the exploit.
    const verdict = validateSurface(surfaceOf([buy({ rateLimit: undefined })]));
    expect(verdict.ok).toBe(false);
    expect(verdict.issues[0].message).toMatch(/this is the exploit, not a performance note/);
  });

  it('refuses a rate limit that is not one', () => {
    for (const perSecond of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateSurface(surfaceOf([buy({ rateLimit: { perSecond } })])).ok).toBe(false);
    }
  });

  it('refuses client traffic with no permission', () => {
    const verdict = validateSurface(surfaceOf([buy({ permission: undefined })]));
    expect(verdict.ok).toBe(false);
    expect(verdict.issues[0].message).toMatch(/an absent one reads as "anyone" without anybody having chosen it/);
  });

  it('lets a message be open to anyone, and asks for the reason out loud', () => {
    const open = validateSurface(surfaceOf([buy({ permission: { policy: 'anyone' } })]));
    expect(open.ok).toBe(true);
    expect(open.issues[0]).toMatchObject({ severity: 'warning', rule: 'permission' });
  });

  it('refuses a role restriction that names no roles', () => {
    expect(validateSurface(surfaceOf([buy({ permission: { policy: 'named-roles', roles: [] } })])).ok).toBe(false);
  });

  it('warns about a burst below the steady rate, which can never be reached', () => {
    expect(rules(surfaceOf([buy({ rateLimit: { perSecond: 10, burst: 2 } })]))).toContain('rate-limit');
  });

  it('notes that a rate limit on server-to-client constrains our own code', () => {
    const outbound = buy({ direction: 'server-to-client', permission: undefined, rateLimit: { perSecond: 1 } });
    expect(rules(surfaceOf([outbound]))).toEqual(['rate-limit']);
  });
});

describe('direction and reliability', () => {
  it('refuses a request from server to client', () => {
    // The client can simply never return, and the calling server thread waits
    // forever. One exploiter freezes a server this way.
    const verdict = validateSurface(surfaceOf([buy({
      direction: 'server-to-client', kind: 'request', returns: [{ name: 'ok', type: 'boolean' }],
      rateLimit: undefined, permission: undefined,
    })]));
    expect(verdict.ok).toBe(false);
    expect(verdict.issues.some((i) => i.rule === 'request-direction')).toBe(true);
  });

  it('refuses an unreliable request, because a reply cannot come back', () => {
    const verdict = validateSurface(surfaceOf([buy({ kind: 'request', reliable: false, returns: [{ name: 'ok', type: 'boolean' }] })]));
    expect(verdict.issues.some((i) => i.rule === 'unreliable-request')).toBe(true);
  });

  it('refuses a request that declares nothing to return', () => {
    const verdict = validateSurface(surfaceOf([buy({ kind: 'request' })]));
    expect(verdict.ok).toBe(false);
    expect(verdict.issues[0].message).toMatch(/waiting for nothing/);
  });

  it('warns about an event that declares returns nothing will send', () => {
    expect(rules(surfaceOf([buy({ returns: [{ name: 'ok', type: 'boolean' }] })]))).toContain('returns');
  });

  it('warns, never fails, on an oversized unreliable payload', () => {
    // The budget is a commonly quoted figure this repository has not verified,
    // so it must not be able to refuse anything.
    const big = buy({ reliable: false, args: Array.from({ length: 20 }, (_, i) => ({ name: `t${i}`, type: 'table' as const })) });
    const verdict = validateSurface(surfaceOf([big]));
    expect(verdict.ok).toBe(true);
    expect(verdict.issues.some((i) => i.rule === 'unreliable-size' && i.severity === 'warning')).toBe(true);
    expect(UNRELIABLE_PAYLOAD_BUDGET_BYTES).toBe(900);
  });
});

describe('field checking', () => {
  it('refuses a type nothing can be checked against', () => {
    // An untyped field puts the handler straight back to trusting whatever the
    // client sent.
    const verdict = validateSurface(surfaceOf([buy({ args: [{ name: 'x', type: 'any' as never }] })]));
    expect(verdict.ok).toBe(false);
    expect(verdict.issues[0].message).toMatch(/which nothing can be checked against/);
  });

  it('refuses a duplicate field and an unnamed one', () => {
    expect(validateSurface(surfaceOf([buy({ args: [{ name: 'x', type: 'number' }, { name: 'x', type: 'number' }] })])).ok).toBe(false);
    expect(validateSurface(surfaceOf([buy({ args: [{ type: 'number' } as never] })])).ok).toBe(false);
  });

  it('refuses a range that admits nothing', () => {
    expect(validateSurface(surfaceOf([buy({ args: [{ name: 'n', type: 'number', range: { min: 10, max: 1 } }] })])).ok).toBe(false);
  });

  it('warns about the checks it cannot make', () => {
    const loose = buy({ args: [
      { name: 'inst', type: 'Instance' },
      { name: 'text', type: 'string' },
      { name: 'blob', type: 'table' },
    ] });
    const messages = validateSurface(surfaceOf([loose])).issues.map((i) => i.message).join(' ');
    expect(messages).toMatch(/any instance the client can reference is accepted/);
    expect(messages).toMatch(/a client can send a very long one/);
    expect(messages).toMatch(/Its contents stay untrusted/);
  });
});

describe('names', () => {
  it('refuses ids and folders that are not plain identifiers', () => {
    // Both become Instance names and Luau fields.
    expect(validateSurface(surfaceOf([buy({ id: 'Buy Item' })])).ok).toBe(false);
    expect(validateSurface(surfaceOf([buy()], 'my folder')).ok).toBe(false);
  });

  it('refuses two messages sharing an id', () => {
    const verdict = validateSurface(surfaceOf([buy(), buy()]));
    expect(verdict.ok).toBe(false);
    expect(verdict.issues[0].message).toMatch(/the second would win silently/);
  });

  it('reports a surface that is not one instead of throwing', () => {
    expect(validateSurface(undefined as never).ok).toBe(false);
    expect(validateSurface({ folder: 'Net' } as never).issues[0].rule).toBe('surface');
  });
});

describe('generation', () => {
  const generated = () => generateNative(surfaceOf([
    buy(),
    { id: 'ScoreChanged', direction: 'server-to-client', kind: 'event', reliable: true, args: [{ name: 'score', type: 'integer' }] },
    { id: 'FastPing', direction: 'client-to-server', kind: 'event', reliable: false, args: [], rateLimit: { perSecond: 30 }, permission: { policy: 'anyone', rationale: 'telemetry' } },
    {
      id: 'GetBalance', direction: 'client-to-server', kind: 'request', reliable: true, args: [],
      returns: [{ name: 'balance', type: 'integer' }],
      rateLimit: { perSecond: 1 }, permission: { policy: 'named-roles', roles: ['member'] },
    },
  ]));

  it('refuses to generate half a network layer', () => {
    // The missing half would be a guard, and an absent guard looks exactly like
    // one that passed.
    expect(() => generateNative(surfaceOf([buy({ rateLimit: undefined })])))
      .toThrow(/Cannot generate Net: 1 error\(s\)\. First: rate-limit/);
  });

  it('picks the class each message actually needs', () => {
    const byName = new Map(generated().instances.map((i) => [i.name, i.className]));
    expect(byName.get('Net')).toBe('Folder');
    expect(byName.get('BuyItem')).toBe('RemoteEvent');
    expect(byName.get('FastPing')).toBe('UnreliableRemoteEvent');
    expect(byName.get('GetBalance')).toBe('RemoteFunction');
  });

  it('checks the rate limit before anything else runs', () => {
    const server = generated().serverLuau;
    expect(server).toMatch(/if not allow\(player, "BuyItem", 4, 8\) then return false end/);
  });

  it('generates a type guard per argument, with the range and the length', () => {
    const server = generated().serverLuau;
    expect(server).toMatch(/type\(a1\) == "string"/);
    expect(server).toMatch(/#a1 <= 64/);
    expect(server).toMatch(/a2 % 1 == 0/);
    expect(server).toMatch(/a2 >= 1/);
    expect(server).toMatch(/a2 <= 99/);
  });

  it('rejects NaN where a number was declared', () => {
    // `type(x) == "number"` is true for NaN, and NaN passes every comparison.
    const server = generateNative(surfaceOf([buy({ args: [{ name: 'n', type: 'number' }] })])).serverLuau;
    expect(server).toMatch(/a1 == a1/);
  });

  it('treats an optional field as absent-or-valid, never as unchecked', () => {
    const server = generateNative(surfaceOf([buy({ args: [{ name: 'n', type: 'integer', optional: true }] })])).serverLuau;
    expect(server).toMatch(/\(a1 == nil or \(/);
  });

  it('defaults the role lookup to refusing, not to admitting', () => {
    // An unimplemented permission check that admits everyone is the failure the
    // whole module exists to prevent.
    expect(generated().serverLuau).toMatch(/function Network\.hasRole\(_player, _role\)\n\treturn false/);
  });

  it('emits the role check for a restricted message', () => {
    expect(generated().serverLuau).toMatch(/if not \(Network\.hasRole\(player, "member"\)\) then return false end/);
  });

  it('drops a client message rather than erroring back at it', () => {
    // Telling a client which guard it failed is a hint about what to try next.
    expect(generated().serverLuau).not.toMatch(/error\("rate limit/);
  });

  it('gives the client a sender per outgoing message and a listener per incoming one', () => {
    const client = generated().clientLuau;
    expect(client).toMatch(/function Network\.BuyItem\(a1, a2\)/);
    expect(client).toMatch(/FireServer\(a1, a2\)/);
    expect(client).toMatch(/function Network\.GetBalance\(\)/);
    expect(client).toMatch(/return root:WaitForChild\("GetBalance"\):InvokeServer\(\)/);
    expect(client).toMatch(/function Network\.onScoreChanged\(handler\)/);
  });

  it('refuses a second handler for one message instead of replacing the first', () => {
    expect(generated().serverLuau).toMatch(/a handler for \{id\} is already registered/);
  });

  it('forgets a player\'s buckets when they leave', () => {
    // A long-running server otherwise keeps a row per player who ever joined.
    expect(generated().serverLuau).toMatch(/PlayerRemoving:Connect\(function\(player\) buckets\[player\] = nil end\)/);
  });
});
