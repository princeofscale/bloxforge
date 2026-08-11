// One description of a game's network surface, and code generated from it.
//
// Roadmap 04, item 8. The thing this replaces is an agent creating a
// `RemoteEvent` named `BuyItem` and a server script that trusts whatever
// arrives on it. Every one of the following is missing from that, and none of
// them announces itself:
//
//   - **A rate limit.** A client can fire a remote in a loop. This is not a
//     performance note; it is the exploit.
//   - **A type check.** `OnServerEvent` hands over whatever the client sent,
//     including a table where a number was expected.
//   - **A permission.** "Who may send this" is a decision, and an absent
//     decision reads as "anyone".
//   - **A direction.** A `RemoteFunction` invoked from server to client lets
//     the client hang the calling thread by never returning.
//
// So the IR carries all four, validation refuses a message missing any of
// them, and the generated Luau enforces what was declared rather than
// documenting it.
//
// Library targets (ByteNet, Remo, RbxUtil's TypedRemote) are deliberately
// absent rather than stubbed. Both MIT, both plausible, and neither has shipped
// in the last eight months — committing the generated surface of every game to
// one of them is exactly the coupling this IR exists to avoid.

export type Direction = 'client-to-server' | 'server-to-client';
export type FieldType = 'boolean' | 'number' | 'integer' | 'string' | 'Vector3' | 'CFrame' | 'Color3' | 'Instance' | 'table';

export interface FieldSpec {
  name: string;
  type: FieldType;
  optional?: boolean;
  /** For `number`/`integer`: the accepted range, inclusive. */
  range?: { min: number; max: number };
  /** For `string`: the longest accepted value. */
  maxLength?: number;
  /** For `Instance`: the class a value must be, checked with IsA. */
  className?: string;
}

export interface RateLimit {
  /** Calls per second per player. */
  perSecond: number;
  /** How many may arrive at once before the rate applies. Defaults to perSecond. */
  burst?: number;
}

export type PermissionPolicy = 'anyone' | 'named-roles';

export interface Permission {
  policy: PermissionPolicy;
  /** Required when the policy is `named-roles`. */
  roles?: string[];
  /** Why this is the right policy. Recorded because "anyone" needs one. */
  rationale?: string;
}

export interface NetworkMessage {
  id: string;
  direction: Direction;
  /** `event` is one-way; `request` expects a reply and becomes a RemoteFunction. */
  kind: 'event' | 'request';
  /** Unreliable messages may be dropped and reordered. Events only. */
  reliable: boolean;
  args: FieldSpec[];
  returns?: FieldSpec[];
  rateLimit?: RateLimit;
  permission?: Permission;
  description?: string;
}

export interface NetworkSurface {
  /** Where the remotes live, as a path inside ReplicatedStorage. */
  folder: string;
  messages: NetworkMessage[];
}

export interface NetworkIssue {
  messageId?: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

const FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>([
  'boolean', 'number', 'integer', 'string', 'Vector3', 'CFrame', 'Color3', 'Instance', 'table',
]);

/**
 * Roblox drops an unreliable payload past a size limit rather than splitting it.
 *
 * ponytail: 900 bytes is the figure commonly quoted for `UnreliableRemoteEvent`
 * and it is **not verified here against Roblox's documentation** — so this
 * produces a warning, never an error, and the constant is named rather than
 * inlined. Upgrade path: confirm the current limit and promote the check.
 */
export const UNRELIABLE_PAYLOAD_BUDGET_BYTES = 900;

/** Rough bytes per field, for the unreliable-size warning only. */
const APPROXIMATE_SIZE: Record<FieldType, number> = {
  boolean: 1, integer: 8, number: 8, string: 64, Vector3: 12, CFrame: 48, Color3: 12, Instance: 8, table: 128,
};

/**
 * Check a surface before a line of it is generated.
 *
 * An error is something the generated code could not enforce or would be wrong
 * to generate. A warning is something that will work and that nobody meant.
 */
export function validateSurface(surface: NetworkSurface): { ok: boolean; issues: NetworkIssue[] } {
  const issues: NetworkIssue[] = [];
  const add = (severity: 'error' | 'warning', rule: string, message: string, messageId?: string) =>
    issues.push({ severity, rule, message, ...(messageId ? { messageId } : {}) });

  if (!surface || typeof surface !== 'object' || !Array.isArray(surface.messages)) {
    add('error', 'surface', 'The surface has no messages array.');
    return { ok: false, issues };
  }
  if (typeof surface.folder !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(surface.folder)) {
    add('error', 'folder', `folder is ${JSON.stringify(surface.folder)}; it becomes an Instance name, so it must be a plain identifier.`);
  }

  const seen = new Set<string>();
  for (const message of surface.messages) {
    if (!message || typeof message !== 'object') {
      add('error', 'message', 'A message entry is not an object.');
      continue;
    }
    const id = message.id;
    if (typeof id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
      add('error', 'id', `Message id ${JSON.stringify(id)} becomes an Instance name and a Luau field, so it must be a plain identifier.`);
      continue;
    }
    if (seen.has(id)) {
      add('error', 'id', `Duplicate message id ${id}; two remotes would share a name and the second would win silently.`, id);
      continue;
    }
    seen.add(id);

    validateFields(message.args, `${id}.args`, add, id);
    if (message.kind === 'request') {
      if (!message.returns || message.returns.length === 0) {
        add('error', 'returns', `${id} is a request but declares no return fields; the caller would be waiting for nothing.`, id);
      } else {
        validateFields(message.returns, `${id}.returns`, add, id);
      }
    } else if (message.returns && message.returns.length > 0) {
      add('warning', 'returns', `${id} is an event but declares return fields, which nothing will ever send.`, id);
    }

    // A RemoteFunction invoked server-to-client hands the calling thread to the
    // client: it can simply never return, and the server waits forever. Roblox
    // has documented this as a hazard for years and it is still the most common
    // way a single exploiter freezes a server.
    if (message.kind === 'request' && message.direction === 'server-to-client') {
      add('error', 'request-direction', `${id} is a request from server to client. The client can never return, and the calling server thread waits forever.`, id);
    }

    if (message.kind === 'request' && message.reliable === false) {
      add('error', 'unreliable-request', `${id} is a request marked unreliable. A reply cannot come back over a channel that may drop it.`, id);
    }

    if (message.direction === 'client-to-server') {
      // The two decisions a hand-made RemoteEvent never records.
      if (!message.rateLimit) {
        add('error', 'rate-limit', `${id} accepts client traffic with no rate limit. A client can fire a remote in a loop; this is the exploit, not a performance note.`, id);
      } else if (!(message.rateLimit.perSecond > 0) || !Number.isFinite(message.rateLimit.perSecond)) {
        add('error', 'rate-limit', `${id} has a rate limit of ${JSON.stringify(message.rateLimit.perSecond)} per second, which is not a limit.`, id);
      } else if (message.rateLimit.burst !== undefined && message.rateLimit.burst < message.rateLimit.perSecond) {
        add('warning', 'rate-limit', `${id} allows a burst of ${message.rateLimit.burst} below its rate of ${message.rateLimit.perSecond}/s, so the steady rate can never be reached.`, id);
      }

      if (!message.permission) {
        add('error', 'permission', `${id} declares no permission. "Who may send this" is a decision, and an absent one reads as "anyone" without anybody having chosen it.`, id);
      } else if (message.permission.policy === 'named-roles' && (message.permission.roles ?? []).length === 0) {
        add('error', 'permission', `${id} restricts to named roles but names none, which admits nobody.`, id);
      } else if (message.permission.policy === 'anyone' && !message.permission.rationale) {
        // Allowed, and it has to be said out loud.
        add('warning', 'permission', `${id} is open to anyone with no rationale recorded. That may be right — say why, so the next reader does not have to guess whether it was a decision.`, id);
      }
    } else if (message.rateLimit) {
      add('warning', 'rate-limit', `${id} goes server to client, where a rate limit constrains code you already control.`, id);
    }

    if (message.reliable === false) {
      const bytes = approximateSize(message.args);
      if (bytes > UNRELIABLE_PAYLOAD_BUDGET_BYTES) {
        add('warning', 'unreliable-size', `${id} carries roughly ${bytes} bytes, over the ~${UNRELIABLE_PAYLOAD_BUDGET_BYTES}-byte budget an unreliable remote is usually given. The figure is an estimate and the budget is unverified here, so this is a warning.`, id);
      }
    }
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

function validateFields(
  fields: FieldSpec[] | undefined,
  where: string,
  add: (severity: 'error' | 'warning', rule: string, message: string, messageId?: string) => void,
  messageId: string,
): void {
  if (!Array.isArray(fields)) {
    add('error', 'fields', `${where} is not a list of fields.`, messageId);
    return;
  }
  const names = new Set<string>();
  for (const field of fields) {
    if (!field || typeof field !== 'object' || typeof field.name !== 'string' || field.name === '') {
      add('error', 'fields', `${where} contains a field with no name.`, messageId);
      continue;
    }
    if (names.has(field.name)) add('error', 'fields', `${where} declares ${field.name} twice.`, messageId);
    names.add(field.name);

    if (!FIELD_TYPES.has(field.type)) {
      // An untyped field is a field the generated guard cannot check, which
      // puts it straight back to trusting whatever the client sent.
      add('error', 'fields', `${where}.${field.name} has type ${JSON.stringify(field.type)}, which nothing can be checked against.`, messageId);
      continue;
    }
    if (field.type === 'Instance' && !field.className) {
      add('warning', 'fields', `${where}.${field.name} is an Instance with no className, so any instance the client can reference is accepted.`, messageId);
    }
    if (field.type === 'string' && field.maxLength === undefined) {
      add('warning', 'fields', `${where}.${field.name} is a string with no maxLength; a client can send a very long one.`, messageId);
    }
    if (field.range && !(field.range.min <= field.range.max)) {
      add('error', 'fields', `${where}.${field.name} has a range whose minimum exceeds its maximum, which admits nothing.`, messageId);
    }
    if (field.type === 'table') {
      add('warning', 'fields', `${where}.${field.name} is a table, and the generated guard can only check that it is one. Its contents stay untrusted.`, messageId);
    }
  }
}

function approximateSize(fields: FieldSpec[] | undefined): number {
  return (fields ?? []).reduce((total, field) => total + (APPROXIMATE_SIZE[field.type] ?? 16), 0);
}

// ─── Native exporter ─────────────────────────────────────────────────

export interface GeneratedNetwork {
  /** Instances to create under ReplicatedStorage. */
  instances: { className: string; name: string; parent: string }[];
  /** Server module that enforces the declared limits before any handler runs. */
  serverLuau: string;
  /** Client module with one typed sender per message. */
  clientLuau: string;
  /** The bucket alone, exactly as the server module embeds it. See `rateLimiterLuau`. */
  rateLimiterLuau: string;
}

/**
 * The token bucket, as its own source.
 *
 * Separated so it can be *run*, not only asserted against as text. It is the
 * security path in everything this file generates — the rest is type guards a
 * reader can check by eye, and a rate limiter that refills wrong is a rate
 * limiter that is not there. `serverModule` embeds this verbatim, so the thing
 * under test and the thing that ships cannot drift.
 *
 * `os.clock` rather than `tick` or `os.time`: monotonic, and in seconds, which
 * is what `perSecond` means.
 */
export function rateLimiterLuau(): string {
  return [
    '-- Token bucket per player per message. Cleared when the player leaves, so a',
    '-- long-running server does not accumulate a row per player who ever joined.',
    'local buckets = {}',
    '',
    'local function allow(player, id, perSecond, burst)',
    '\tlocal now = os.clock()',
    '\tlocal byPlayer = buckets[player]',
    '\tif not byPlayer then byPlayer = {} buckets[player] = byPlayer end',
    '\tlocal bucket = byPlayer[id]',
    '\tif not bucket then bucket = { tokens = burst, last = now } byPlayer[id] = bucket end',
    '\tbucket.tokens = math.min(burst, bucket.tokens + (now - bucket.last) * perSecond)',
    '\tbucket.last = now',
    '\tif bucket.tokens < 1 then return false end',
    '\tbucket.tokens = bucket.tokens - 1',
    '\treturn true',
    'end',
  ].join('\n');
}

/**
 * Generate the remotes and the code that guards them.
 *
 * Refuses an invalid surface. Generating half a network layer is worse than
 * generating none: the missing half is a guard, and its absence looks exactly
 * like a guard that passed.
 */
export function generateNative(surface: NetworkSurface): GeneratedNetwork {
  const verdict = validateSurface(surface);
  if (!verdict.ok) {
    const errors = verdict.issues.filter((i) => i.severity === 'error');
    throw new Error(`Cannot generate ${surface?.folder ?? 'surface'}: ${errors.length} error(s). First: ${errors[0].rule} — ${errors[0].message}`);
  }

  const root = `ReplicatedStorage.${surface.folder}`;
  const instances = [
    { className: 'Folder', name: surface.folder, parent: 'ReplicatedStorage' },
    ...surface.messages.map((m) => ({ className: classOf(m), name: m.id, parent: root })),
  ];

  return {
    instances,
    serverLuau: serverModule(surface),
    clientLuau: clientModule(surface),
    rateLimiterLuau: rateLimiterLuau(),
  };
}

function classOf(message: NetworkMessage): string {
  if (message.kind === 'request') return 'RemoteFunction';
  return message.reliable === false ? 'UnreliableRemoteEvent' : 'RemoteEvent';
}

/** A Luau expression that is true when `value` matches the field. */
function guardExpression(field: FieldSpec, value: string): string {
  const checks: string[] = [];
  switch (field.type) {
    case 'integer':
      checks.push(`type(${value}) == "number"`, `${value} % 1 == 0`);
      break;
    case 'number':
      checks.push(`type(${value}) == "number"`, `${value} == ${value}`); // NaN ~= NaN
      break;
    case 'boolean':
    case 'string':
    case 'table':
      checks.push(`type(${value}) == "${field.type}"`);
      break;
    case 'Instance':
      checks.push(`typeof(${value}) == "Instance"`);
      if (field.className) checks.push(`${value}:IsA("${field.className}")`);
      break;
    default:
      checks.push(`typeof(${value}) == "${field.type}"`);
  }
  if (field.range) checks.push(`${value} >= ${field.range.min}`, `${value} <= ${field.range.max}`);
  if (field.maxLength !== undefined) checks.push(`#${value} <= ${field.maxLength}`);

  const body = checks.join(' and ');
  // An optional field is absent *or* valid — never "absent, so skip the rest",
  // which is how an optional field becomes an unchecked one.
  return field.optional ? `(${value} == nil or (${body}))` : `(${value} ~= nil and (${body}))`;
}

function serverModule(surface: NetworkSurface): string {
  const lines: string[] = [
    '-- Generated by BloxForge from a network IR. Do not edit: regenerate.',
    '--',
    '-- Every limit here was declared in the IR. A handler registered through',
    '-- this module never sees a call that failed a guard, so "the arguments are',
    '-- the right shape" is true by the time it runs rather than by convention.',
    'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
    'local Players = game:GetService("Players")',
    '',
    `local root = ReplicatedStorage:WaitForChild("${surface.folder}")`,
    'local Network = {}',
    'local handlers = {}',
    '',
    // Embedded verbatim from `rateLimiterLuau`, which the runtime harness runs
    // on its own. Embedding rather than re-deriving is what keeps the tested
    // bucket and the shipped bucket the same source.
    rateLimiterLuau(),
    'Players.PlayerRemoving:Connect(function(player) buckets[player] = nil end)',
    '',
    '-- Replace with the project\'s own role lookup. Returning false by default is',
    '-- deliberate: an unimplemented permission check that admits everyone is the',
    '-- failure this whole module exists to prevent.',
    'function Network.hasRole(_player, _role)',
    '\treturn false',
    'end',
    '',
  ];

  for (const message of surface.messages.filter((m) => m.direction === 'client-to-server')) {
    const remote = `root:WaitForChild("${message.id}")`;
    const rate = message.rateLimit!;
    const burst = rate.burst ?? rate.perSecond;
    const guards = message.args.map((field, index) => guardExpression(field, `a${index + 1}`));
    const params = message.args.map((_, index) => `a${index + 1}`).join(', ');

    lines.push(
      `-- ${message.id}: ${message.description ?? 'no description'}`,
      `local ${message.id}Remote = ${remote}`,
      `local function ${message.id}Check(player${params ? `, ${params}` : ''})`,
      `\tif not allow(player, "${message.id}", ${rate.perSecond}, ${burst}) then return false end`,
    );
    if (message.permission!.policy === 'named-roles') {
      const roles = message.permission!.roles!.map((r) => `Network.hasRole(player, "${r}")`).join(' or ');
      lines.push(`\tif not (${roles}) then return false end`);
    }
    if (guards.length > 0) lines.push(`\tif not (${guards.join(' and ')}) then return false end`);
    lines.push('\treturn true', 'end', '');

    if (message.kind === 'event') {
      lines.push(
        `${message.id}Remote.OnServerEvent:Connect(function(player${params ? `, ${params}` : ''})`,
        `\tif not ${message.id}Check(player${params ? `, ${params}` : ''}) then return end`,
        `\tlocal handler = handlers["${message.id}"]`,
        `\tif handler then handler(player${params ? `, ${params}` : ''}) end`,
        'end)',
        '',
      );
    } else {
      lines.push(
        `${message.id}Remote.OnServerInvoke = function(player${params ? `, ${params}` : ''})`,
        `\tif not ${message.id}Check(player${params ? `, ${params}` : ''}) then return nil end`,
        `\tlocal handler = handlers["${message.id}"]`,
        `\tif not handler then return nil end`,
        `\treturn handler(player${params ? `, ${params}` : ''})`,
        'end',
        '',
      );
    }
  }

  const serverSent = surface.messages.filter((m) => m.direction === 'server-to-client');
  for (const message of serverSent) {
    const params = message.args.map((_, index) => `a${index + 1}`).join(', ');
    lines.push(
      `function Network.${message.id}(player${params ? `, ${params}` : ''})`,
      `\troot:WaitForChild("${message.id}"):FireClient(player${params ? `, ${params}` : ''})`,
      'end',
      '',
    );
  }

  lines.push(
    'function Network.on(id, handler)',
    '\tif handlers[id] then error(`a handler for {id} is already registered`) end',
    '\thandlers[id] = handler',
    'end',
    '',
    'return Network',
  );
  return lines.join('\n');
}

function clientModule(surface: NetworkSurface): string {
  const lines: string[] = [
    '-- Generated by BloxForge from a network IR. Do not edit: regenerate.',
    'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
    `local root = ReplicatedStorage:WaitForChild("${surface.folder}")`,
    'local Network = {}',
    '',
  ];

  for (const message of surface.messages) {
    const params = message.args.map((_, index) => `a${index + 1}`).join(', ');
    if (message.direction === 'client-to-server') {
      const call = message.kind === 'request' ? 'InvokeServer' : 'FireServer';
      const prefix = message.kind === 'request' ? 'return ' : '';
      lines.push(
        `function Network.${message.id}(${params})`,
        `\t${prefix}root:WaitForChild("${message.id}"):${call}(${params})`,
        'end',
        '',
      );
    } else {
      lines.push(
        `function Network.on${message.id}(handler)`,
        `\treturn root:WaitForChild("${message.id}").OnClientEvent:Connect(handler)`,
        'end',
        '',
      );
    }
  }

  lines.push('return Network');
  return lines.join('\n');
}
