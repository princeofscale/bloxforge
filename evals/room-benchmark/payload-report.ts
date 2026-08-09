#!/usr/bin/env node
// The half of the roadmap's A3 measurement contract that runs without a budget.
//
//   npx tsx evals/room-benchmark/payload-report.ts [--check]
//
// The contract asks for serialized bytes split by category — schemas, tool
// args, tool results, assistant/reasoning — plus model requests, tool calls,
// wall time, task success and a scene digest. Three of those categories are
// deterministic given the routes: the schemas each route needs, the arguments
// it sends, and the results it gets back. Those are computed here and gated
// against a committed baseline.
//
// ponytail: assistant/reasoning tokens, provider-reported cached input, wall
// time and task success are not here and cannot be — they need a model, a
// provider key and a connected Studio. The roadmap wants 20-30 repeats per
// route on a pinned model before anything is concluded, and this report says
// what it covers rather than presenting three of seven categories as the
// answer. Upgrade path: run.ts with the room fixture as its task.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES, type RouteName, type ToolCall } from './routes.js';
import { roomParts } from './fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(`${root}/`);

const { TOOL_DEFINITIONS } = require('./packages/core/dist/tools/definitions.js');
const { bulkReceipt } = require('./packages/core/dist/compact.js');

const schemaOf = new Map<string, unknown>(
  TOOL_DEFINITIONS.map((d: { name: string }) => [d.name, d]),
);

const bytes = (v: unknown) => JSON.stringify(v).length;

/**
 * What the plugin sends back for a call, as it actually does today.
 *
 * Not invented: `create_object` answers with the created instance's identity,
 * `mass_create_objects` with a row per object plus a summary, and
 * `execute_luau` with its return value. Route B's result then goes through
 * `bulkReceipt`, because that is what the server does before the model sees it
 * — measuring B against a raw row-per-object response would be measuring a
 * version of BloxForge that no longer exists.
 */
function resultFor(call: ToolCall): unknown {
  const parts = roomParts();
  if (call.tool === 'create_object') {
    const name = (call.args as { name: string }).name;
    return { success: true, path: `game.Workspace.BenchmarkRoom.${name}`, className: 'Part', name };
  }
  if (call.tool === 'mass_create_objects') {
    const raw = {
      results: parts.map((p) => ({
        path: `game.Workspace.BenchmarkRoom.${p.name}`,
        success: true,
        className: 'Part',
      })),
      summary: { total: parts.length, succeeded: parts.length, failed: 0 },
    };
    return bulkReceipt(raw);
  }
  return { success: true, returnValue: { built: parts.length } };
}

interface RouteReport {
  route: RouteName;
  toolCalls: number;
  /** Every distinct tool the route needs a schema for, and their serialized size. */
  schemaBytes: number;
  argBytes: number;
  resultBytes: number;
  totalBytes: number;
}

function measure(route: RouteName): RouteReport {
  const calls = ROUTES[route]();
  const distinct = [...new Set(calls.map((c) => c.tool))];
  const missing = distinct.filter((t) => !schemaOf.has(t));
  if (missing.length > 0) {
    // A route naming a tool that no longer exists would otherwise report a
    // smaller schema cost and look like an improvement.
    throw new Error(`route ${route} calls unknown tool(s): ${missing.join(', ')}`);
  }
  return {
    route,
    toolCalls: calls.length,
    schemaBytes: distinct.reduce((sum, t) => sum + bytes(schemaOf.get(t)), 0),
    argBytes: calls.reduce((sum, c) => sum + bytes(c.args), 0),
    resultBytes: calls.reduce((sum, c) => sum + bytes(resultFor(c)), 0),
    totalBytes: 0,
  };
}

const reports = (['A', 'B', 'C'] as RouteName[]).map((r) => {
  const m = measure(r);
  m.totalBytes = m.schemaBytes + m.argBytes + m.resultBytes;
  return m;
});

const LABEL: Record<RouteName, string> = {
  A: 'many create_object',
  B: 'one mass_create_objects',
  C: 'one execute_luau',
};

const pad = (s: string | number, n: number) => String(s).padStart(n);
console.error(`room payload, ${roomParts().length} parts (schemas + args + results; assistant tokens not included)`);
console.error(`  route  ${'calls'.padStart(6)} ${'schema'.padStart(8)} ${'args'.padStart(8)} ${'results'.padStart(8)} ${'total'.padStart(9)}   `);
for (const r of reports) {
  console.error(`  ${r.route}      ${pad(r.toolCalls, 6)} ${pad(r.schemaBytes, 8)} ${pad(r.argBytes, 8)} ${pad(r.resultBytes, 8)} ${pad(r.totalBytes, 9)}   ${LABEL[r.route]}`);
}

const baselinePath = `${here}/baseline.json`;
const report = { parts: roomParts().length, routes: reports };

const flags = process.argv.slice(2);
const unknown = flags.filter((f) => !['--check', '--update'].includes(f));
if (unknown.length > 0) {
  console.error(`payload-report: unrecognised option(s) ${unknown.join(', ')}`);
  process.exit(2);
}
if (flags.includes('--update') && flags.includes('--check')) {
  console.error('payload-report: --update and --check are mutually exclusive');
  process.exit(2);
}
if (flags.includes('--update')) {
  writeFileSync(baselinePath, `${JSON.stringify(report, null, 1)}\n`);
  console.error(`\nbaseline written to ${baselinePath}`);
  process.exit(0);
}
if (flags.includes('--check')) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as typeof report;
  const problems: string[] = [];
  if (baseline.parts !== report.parts) problems.push(`part count ${report.parts} vs baseline ${baseline.parts}`);
  for (const now of report.routes) {
    const was = baseline.routes.find((r) => r.route === now.route);
    if (!was || !Number.isFinite(was.totalBytes)) {
      problems.push(`baseline has no usable entry for route ${now.route}`);
      continue;
    }
    // 2% either way: the payload is deterministic, so anything larger is a real
    // change in what a route puts on the wire and should be looked at, in
    // either direction — a sudden drop is as likely to be a route that stopped
    // doing the work as one that got cheaper.
    const drift = Math.abs(now.totalBytes - was.totalBytes) / was.totalBytes;
    if (drift > 0.02) {
      problems.push(`route ${now.route}: ${now.totalBytes} bytes vs baseline ${was.totalBytes} (${(drift * 100).toFixed(1)}%)`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error('\npayload-report: the routes no longer put what the baseline says on the wire. Re-baseline with --update and say why.');
    process.exit(1);
  }
  console.error('\npayload-report: all three routes match the committed baseline.');
}
