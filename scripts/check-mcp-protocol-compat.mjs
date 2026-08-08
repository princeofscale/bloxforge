// Dynamic toolsets versus the MCP protocol revision.
//
// `load_toolset` changes which tools are advertised, as a side effect of a
// tools/call on the connection, and the resulting set differs between two
// connections that loaded different domains. Both are explicitly forbidden from
// MCP 2026-07-28 onward:
//
//   "This set MAY be empty and MAY change over time [...] but MUST NOT vary
//    per-connection or as a side effect of other requests on the connection."
//   — https://modelcontextprotocol.io/specification/2026-07-28/server/tools
//
// Under 2025-11-25 and earlier — every revision the pinned SDK can actually
// negotiate — the behaviour is allowed, so this is a latent conflict rather than
// a live defect. The danger is that it stops being latent silently: bumping
// @modelcontextprotocol/sdk to a release that speaks 2026-07-28 would make the
// server violate a MUST NOT with no test failing and no code changing.
//
// So this fails the build at the moment the SDK gains such a version, while the
// bump is still in front of someone, rather than after it ships. Invariant 6:
// fail closed, explain, never silently downgrade.
//
// Resolving it when it fires means gating the dynamic path on the negotiated
// version — serve a static profile and drop the `listChanged` capability under
// a forbidding revision, keep lazy toolsets under a negotiated 2025-11-25 —
// not deleting this check.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

// The SDK does not expose ./package.json through its `exports`, so requiring it
// yields an object with no `version`. Resolve a real export and walk up to the
// manifest instead — the version belongs in the output, since the whole point
// of this check is to name the bump that changed the answer.
//
// The marker is built with path.join so it carries the platform separator: a
// hardcoded '@modelcontextprotocol/sdk/' never matches a Windows path, and the
// slice would then run off a -1 index and read a nonsense manifest.
function sdkVersionOf(entry) {
  const resolved = require.resolve(entry);
  const marker = join('@modelcontextprotocol', 'sdk');
  const at = resolved.lastIndexOf(marker);
  if (at < 0) throw new Error(`Resolved the MCP SDK to an unexpected path: ${resolved}`);
  return JSON.parse(readFileSync(join(resolved.slice(0, at + marker.length), 'package.json'), 'utf8')).version;
}

// First revision that forbids per-connection and side-effect tool-set changes.
// Version ids are YYYY-MM-DD, so string comparison is date comparison.
const FIRST_FORBIDDING_VERSION = '2026-07-28';

// This reads the *installed* SDK, so it needs a root `npm ci` — which is why it
// runs in the main CI job and release:check rather than in protocol:check. The
// plugin job installs only studio-plugin's dependencies, and every other script
// in protocol:check is dependency-free by design. Say that plainly instead of
// surfacing a bare MODULE_NOT_FOUND.
let types;
try {
  types = require('@modelcontextprotocol/sdk/types.js');
} catch (error) {
  if ((error && error.code) !== 'MODULE_NOT_FOUND') throw error;
  throw new Error(
    'Could not load @modelcontextprotocol/sdk. This check reads the installed SDK, ' +
    'so it must run after a root `npm ci` — not from a job that installs only a ' +
    'sub-package. Do not move it back into protocol:check.',
    { cause: error },
  );
}

const { SUPPORTED_PROTOCOL_VERSIONS, LATEST_PROTOCOL_VERSION } = types;
const sdkVersion = sdkVersionOf('@modelcontextprotocol/sdk/types.js');

if (!Array.isArray(SUPPORTED_PROTOCOL_VERSIONS) || SUPPORTED_PROTOCOL_VERSIONS.length === 0) {
  // A renamed or restructured export would otherwise read as "nothing forbidding
  // found", which is the silent pass this check exists to prevent.
  throw new Error(
    'Could not read SUPPORTED_PROTOCOL_VERSIONS from the MCP SDK. The export moved or ' +
    'was renamed; fix this check rather than letting it pass on an empty list.',
  );
}

const forbidding = SUPPORTED_PROTOCOL_VERSIONS
  .filter((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= FIRST_FORBIDDING_VERSION)
  .sort();

console.log(JSON.stringify({
  sdk: sdkVersion,
  latestProtocolVersion: LATEST_PROTOCOL_VERSION,
  supported: SUPPORTED_PROTOCOL_VERSIONS,
  firstForbiddingVersion: FIRST_FORBIDDING_VERSION,
  negotiableForbiddingVersions: forbidding,
}));

if (forbidding.length > 0) {
  throw new Error(
    `The pinned MCP SDK (${sdkVersion}) can now negotiate ${forbidding.join(', ')}, ` +
    `which forbids a tool set that varies per-connection or changes as a side effect ` +
    `of another request — exactly what load_toolset/unload does. Gate the dynamic path ` +
    `on the negotiated protocol version (static profile + no listChanged capability ` +
    `under a forbidding revision) before shipping this SDK bump.`,
  );
}

console.log(
  `mcp-protocol-compat: dynamic toolsets are permitted under every version this SDK can negotiate ` +
  `(latest ${LATEST_PROTOCOL_VERSION}, first forbidding ${FIRST_FORBIDDING_VERSION}).`,
);
