#!/usr/bin/env node
// The probe report decides whether a host keeps dynamic tool loading, so the
// two ways it could be wrong both matter: calling a host DYNAMIC on a journal
// that does not earn it, and calling one STATIC when it does.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'bloxforge-probe-'));
const script = 'scripts/probe-report.mjs';

/** One repetition: a change, a refresh after `refreshMs`, then the canary. */
function repetition(t0, { refreshMs = 100, canaryMs = 500, canaryOk = true, turnEndMs = null } = {}) {
  const lines = [
    { t: t0, kind: 'list_changed', generation: 1 },
    { t: t0 + refreshMs, kind: 'list_served', generation: 1, count: 40 },
  ];
  if (turnEndMs !== null) lines.push({ t: t0 + turnEndMs, kind: 'mark', generation: -1, label: 'turn-end' });
  if (canaryMs !== null) {
    lines.push({ t: t0 + canaryMs, kind: 'tool_call', generation: 1, tool: 'get_spatial_layout', newlyAdvertised: true, ok: canaryOk });
  }
  return lines;
}

function journal(name, reps) {
  const path = join(dir, name);
  writeFileSync(path, `${reps.flat().map((e) => JSON.stringify(e)).join('\n')}\n`);
  return path;
}

const run = (path, expectStatus = 0) => {
  const r = spawnSync(process.execPath, [script, path, '--host', 'test'], { encoding: 'utf8' });
  assert.equal(r.status, expectStatus, `expected exit ${expectStatus}, got ${r.status}: ${r.stderr}`);
  return r.stdout + r.stderr;
};

try {
  // 30 clean repetitions, canary always before the turn boundary → DYNAMIC.
  const good = journal('good.jsonl',
    Array.from({ length: 30 }, (_, i) => repetition(i * 10_000, { canaryMs: 500, turnEndMs: 900 })));
  const goodOut = run(good);
  assert.match(goodOut, /canary callable same turn\s+100\.0%\s+30\/30/);
  assert.match(goodOut, /verdict: DYNAMIC/);

  // 29/30 is exactly the gate and must still pass.
  const edge = journal('edge.jsonl', Array.from({ length: 30 }, (_, i) =>
    repetition(i * 10_000, { canaryMs: i === 0 ? 1200 : 500, turnEndMs: 900 })));
  assert.match(run(edge), /verdict: DYNAMIC/);

  // 28/30 is below it and must not.
  const below = journal('below.jsonl', Array.from({ length: 30 }, (_, i) =>
    repetition(i * 10_000, { canaryMs: i < 2 ? 1200 : 500, turnEndMs: 900 })));
  const belowOut = run(below);
  assert.match(belowOut, /verdict: STATIC/);
  assert.match(belowOut, /canary callable next turn\s+6\.7%/);

  // A host that refreshes instantly but never lets the model call the tool is
  // the case the whole probe exists for: prompt UI, no capability.
  const refreshOnly = journal('refresh-only.jsonl',
    Array.from({ length: 30 }, (_, i) => repetition(i * 10_000, { refreshMs: 30, canaryMs: null })));
  const refreshOut = run(refreshOnly);
  assert.match(refreshOut, /refreshed within 2000ms\s+100\.0%/);
  assert.match(refreshOut, /canary never callable\s+100\.0%/);
  assert.match(refreshOut, /verdict: STATIC/);

  // Fewer than 30 cannot reach 29/30 and must not be labelled either way.
  const short = journal('short.jsonl',
    Array.from({ length: 10 }, (_, i) => repetition(i * 10_000, { turnEndMs: 900 })));
  assert.match(run(short), /verdict: INCONCLUSIVE/);

  // Fail closed on unusable input rather than scoring it as zero.
  writeFileSync(join(dir, 'empty.jsonl'), '');
  run(join(dir, 'empty.jsonl'), 1);
  writeFileSync(join(dir, 'torn.jsonl'), '{"t":1,"kind":"list_changed"}\n{"t":2,"kind":\n');
  const torn = spawnSync(process.execPath, [script, join(dir, 'torn.jsonl')], { encoding: 'utf8' });
  assert.notEqual(torn.status, 0, 'a truncated journal must not be scored');
  const noChange = journal('no-change.jsonl', [[{ t: 1, kind: 'list_served', generation: 0, count: 29 }]]);
  run(noChange, 1);

  // Stale-call rate counts errors among calls to newly advertised tools.
  const stale = journal('stale.jsonl', Array.from({ length: 30 }, (_, i) =>
    repetition(i * 10_000, { canaryOk: i < 6 ? false : true, turnEndMs: 900 })));
  assert.match(run(stale), /stale-call error rate\s+20\.0%/);

  console.error('probe-report: gate at 29/30 holds in both directions; refresh without capability scores STATIC; unusable journals fail closed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
