#!/usr/bin/env node
// eval_server_runtime / eval_client_runtime must surface the actual user
// error, not Roblox's generic "Requested module experienced an error while
// loading" wrapper. The bridge does pcall(require, payload), which loses
// the real message + line; the wrapper around user code wraps it in xpcall
// inside the IIFE so the real error survives.
//
// Regression test for the eval-bridge error-swallow bug fixed in v2.11.3.

import { McpClient, runTest, assert, assertContains, assertNotContains, startPlaytestAndWait, safeStopPlaytest } from './lib/mcp-client.mjs';

const MARKER = 'EVAL_ERR_MARKER_3f4a9c';
const GENERIC = 'Requested module experienced an error while loading';

await runTest('eval_server_runtime preserves user error', async ({ track }) => {
  const client = track(new McpClient('A'));
  await client.start();
  await client.initialize();

  await startPlaytestAndWait(client);

  try {
    // Case 1: explicit error() with distinctive message
    const r1 = await client.callTool('eval_server_runtime', {
      code: `error("${MARKER}-explicit-error")`,
    });
    assert(r1.ok === false, 'eval_server_runtime reports ok=false on error');
    assert(r1.bridge === 'ok', 'bridge reached server peer');
    assertContains(JSON.stringify(r1), `${MARKER}-explicit-error`,
      'response carries the actual user error message');
    assertNotContains(JSON.stringify(r1), GENERIC,
      'response does NOT carry the generic require wrapper message');

    // Case 2: nil deref (different error class)
    const r2 = await client.callTool('eval_server_runtime', {
      code: `local x = nil\nreturn x.${MARKER}_field`,
    });
    assert(r2.ok === false, 'nil deref reports ok=false');
    assertContains(JSON.stringify(r2), `${MARKER}_field`,
      'response surfaces the nil-deref field name');
    assertNotContains(JSON.stringify(r2), GENERIC,
      'nil deref does NOT use the generic wrapper');

    // Case 3: success path still works
    const r3 = await client.callTool('eval_server_runtime', {
      code: `return 6 * 7`,
    });
    assert(r3.ok === true, 'success path still returns ok=true');
    assertContains(JSON.stringify(r3), '42', 'success result preserved');

    // Case 4: parse/compile error — engine collapses these into GENERIC
    // from pcall(require, m). Wrapper must recover the real parser
    // diagnostic from LogService.
    const r4 = await client.callTool('eval_server_runtime', {
      code: `this is not valid luau syntax @#$`,
    });
    assert(r4.ok === false, 'eval_server_runtime parse error reports ok=false');
    assertContains(r4.error || '', 'user_code:',
      'parse-error response carries the normalized user-code parser diagnostic');
    assertNotContains(r4.error || '', GENERIC,
      'parse-error response does NOT fall back to the generic require wrapper');

    // Case 5: parse error on client peer too
    const r5 = await client.callTool('eval_client_runtime', {
      code: `!!! syntax error here`,
      target: 'client-1',
    });
    assert(r5.ok === false, 'eval_client_runtime parse error reports ok=false');
    assertContains(r5.error || '', 'user_code:',
      'client parse-error response carries the normalized user-code parser diagnostic');
    assertNotContains(r5.error || '', GENERIC,
      'client parse-error response does NOT fall back to the generic require wrapper');
  } finally {
    await safeStopPlaytest(client);
  }
}).then((ok) => process.exit(ok ? 0 : 1));
