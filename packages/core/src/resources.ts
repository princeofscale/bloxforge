// MCP resources (data plane) over the existing world-model tools. The same
// snapshot/node/changefeed data, exposed as cacheable canonical URIs so hosts
// (Cursor, Codex) can read and reuse them independently of the tool surface — a
// thin layer on top, not a replacement for tools. Research review #2.
//
//   roblox://world/snapshot?view=overview|standard   -> get_world_snapshot
//   roblox://node/<dot.path>                          -> get_node_batch([path])
//   roblox://world/changes?since=<snapshotId>         -> get_changes_since

import type { RobloxStudioTools } from './tools/index.js';

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const RESOURCE_LIST: ResourceDescriptor[] = [
  {
    uri: 'roblox://world/snapshot?view=overview',
    name: 'World snapshot (overview)',
    description: 'Token-lean place overview: counts, top classes, subtree roots, environment.',
    mimeType: 'application/json',
  },
  {
    uri: 'roblox://world/changes',
    name: 'World changes (baseline)',
    description: 'Capture a change-tracking baseline; read roblox://world/changes?since=<id> afterwards for the diff.',
    mimeType: 'application/json',
  },
];

export const RESOURCE_TEMPLATES = [
  { uriTemplate: 'roblox://world/snapshot{?view}', name: 'World snapshot', description: 'view=overview|standard', mimeType: 'application/json' },
  { uriTemplate: 'roblox://node/{path}', name: 'Node', description: 'Dot-path of an instance, e.g. game.Workspace.Map', mimeType: 'application/json' },
  { uriTemplate: 'roblox://world/changes{?since}', name: 'World changefeed', description: 'Omit `since` for a baseline; pass a prior snapshotId for the diff.', mimeType: 'application/json' },
];

export type ParsedResource =
  | { kind: 'snapshot'; view: 'overview' | 'standard' }
  | { kind: 'node'; path: string }
  | { kind: 'changes'; since?: string }
  | { kind: 'unknown' };

/** Pure URI parser — maps a roblox:// URI to a resource descriptor. */
export function parseResourceUri(uri: string): ParsedResource {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return { kind: 'unknown' };
  }
  if (u.protocol !== 'roblox:') return { kind: 'unknown' };
  // host + pathname together form the logical path (URL puts the first segment in host)
  const segments = `${u.host}${u.pathname}`.split('/').filter(Boolean);

  if (segments[0] === 'world' && segments[1] === 'snapshot') {
    const view = u.searchParams.get('view') === 'standard' ? 'standard' : 'overview';
    return { kind: 'snapshot', view };
  }
  if (segments[0] === 'world' && segments[1] === 'changes') {
    const since = u.searchParams.get('since') ?? undefined;
    return { kind: 'changes', since };
  }
  if (segments[0] === 'node' && segments.length >= 2) {
    const path = decodeURIComponent(segments.slice(1).join('/'));
    return { kind: 'node', path };
  }
  return { kind: 'unknown' };
}

function extractText(result: { content?: Array<{ type: string; text?: string }> }): string {
  const block = result.content?.find((c) => c.type === 'text' && typeof c.text === 'string');
  return block?.text ?? '{}';
}

/** Read a resource by dispatching to the world-model tools. */
export async function readResource(
  tools: RobloxStudioTools,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const parsed = parseResourceUri(uri);
  let result: { content?: Array<{ type: string; text?: string }> };
  switch (parsed.kind) {
    case 'snapshot':
      result = await tools.getWorldSnapshot(undefined, parsed.view);
      break;
    case 'node':
      result = await tools.getNodeBatch([parsed.path], undefined, true);
      break;
    case 'changes':
      result = await tools.getChangesSince(parsed.since);
      break;
    default:
      throw new Error(`Unknown resource URI: ${uri}`);
  }
  return { contents: [{ uri, mimeType: 'application/json', text: extractText(result) }] };
}
