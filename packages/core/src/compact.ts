// Token-efficiency helper for tool responses. Studio read tools return a lot of
// geometry (positions, sizes, CFrames) where the plugin emits full float noise
// like 175.00000000001 or 0.9019607843 — each such number is several wasted
// tokens in the agent's context. compact() rounds floats to a sane precision
// (integers, e.g. asset ids, are left exact) and drops null/undefined fields,
// which shrinks responses substantially with no information the agent needs.

export function roundFloat(n: number, decimals: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return n;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function compact<T>(value: T, decimals = 3): T {
  if (typeof value === 'number') {
    return roundFloat(value, decimals) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => compact(v, decimals)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = compact(v, decimals);
    }
    return out as unknown as T;
  }
  return value;
}

/** Build a token-lean text tool-result: compact the payload, then stringify. */
export function compactText(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(compact(payload)) }] };
}

type BulkRow = Record<string, unknown> & { success?: unknown };

/**
 * Collapse a bulk write's `results` array into a receipt, without losing
 * anything the caller cannot already reconstruct.
 *
 * The plugin answers a bulk write with one row per input. For
 * `mass_set_property` those rows are
 * `{ path, success: true, propertyName, propertyValue }` — and `propertyName`
 * and `propertyValue` are the same on every row, because the caller supplied
 * one of each for the whole call. At 200 paths that response measures ~6,600
 * tokens to say "all 200 succeeded"; the receipt says it in 31.
 *
 * Two rules, both lossless:
 *
 * 1. A key that carries an identical value on every successful row is hoisted
 *    out of the rows and stated once. Derived rather than named, so it also
 *    catches `mass_delete_objects` deleting 200 Parts, and stops hoisting the
 *    moment the rows genuinely differ.
 * 2. If hoisting leaves every successful row as nothing but its path, the rows
 *    go entirely. The caller sent that list of paths and every failure is named
 *    below, so "which ones succeeded" is exactly "the ones I sent, minus these"
 *    — the response was spending tokens reading the caller's own argument back
 *    to it. Where a successful row still carries something of its own, the rows
 *    stay.
 *
 * Failures always keep full per-row detail: that is the half of the answer that
 * carries information, and it is never the half that is large.
 */
export type ReturnMode = 'receipt' | 'failures' | 'full';

const RETURN_MODES: readonly ReturnMode[] = ['receipt', 'failures', 'full'];

export function isReturnMode(value: unknown): value is ReturnMode {
  return typeof value === 'string' && (RETURN_MODES as readonly string[]).includes(value);
}

export function bulkReceipt<T extends { results?: unknown }>(
  payload: T,
  rowKey = 'path',
  mode: ReturnMode = 'receipt',
): unknown {
  // `full` is the debugging escape hatch: whatever the plugin actually said,
  // unedited. Every compaction below is lossless by construction, but "I
  // believe it is lossless" is not the same as being able to look.
  if (mode === 'full') return payload;

  const rows = payload?.results;
  if (!Array.isArray(rows) || rows.length === 0) return payload;
  if (!rows.every((row): row is BulkRow => !!row && typeof row === 'object' && !Array.isArray(row))) {
    return payload;
  }

  // A response whose rows carry no `success` flag is not a bulk write result
  // this function describes, and it is left alone — checked here rather than
  // after the `failures` branch, where it was letting that mode reclassify
  // every row of an unrecognised shape as a failure. Receipt mode had the
  // guard; `failures` ran ahead of it.
  if (!rows.some((row) => 'success' in row)) return payload;

  const ok = rows.filter((row) => row.success === true);
  const failed = rows.filter((row) => row.success !== true);

  // `failures` drops the successful side entirely — for a caller that has
  // already decided it only acts on what went wrong.
  //
  // No counters are invented for it. A first draft added `changed`/`failed` on
  // the reasoning that "no failures" and "nothing ran" would otherwise be the
  // same response; the plugin's own `summary: { total, succeeded, failed }`
  // already answers that and rides along in `head`. Restating it under new
  // names would have been the same waste #98 removed, one field smaller — and
  // the existing test caught it.
  if (mode === 'failures') {
    const { results: _all, ...head } = payload as Record<string, unknown>;
    void _all;
    return {
      ...head,
      ...(failed.length > 0 ? { failures: failed.map(({ success: _s, ...f }) => f) } : {}),
    };
  }
  // Nothing succeeded, or the rows do not use the success flag at all: leave it
  // alone rather than invent a shape for a response this does not describe.
  if (ok.length === 0) return payload;

  const shared: Record<string, unknown> = {};
  for (const key of Object.keys(ok[0])) {
    if (key === rowKey || key === 'success') continue;
    const first = JSON.stringify(ok[0][key]);
    if (ok.every((row) => key in row && JSON.stringify(row[key]) === first)) {
      shared[key] = ok[0][key];
    }
  }

  const remainder = ok.map((row) => {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === 'success' || key in shared) continue;
      rest[key] = value;
    }
    return rest;
  });
  const rowsCarryOnlyTheirKey = remainder.every(
    (rest) => Object.keys(rest).length === 0 || (Object.keys(rest).length === 1 && rowKey in rest),
  );

  const { results: _dropped, ...rest } = payload as Record<string, unknown>;
  void _dropped;
  return {
    ...rest,
    ...shared,
    ...(rowsCarryOnlyTheirKey ? {} : { succeeded: remainder }),
    ...(failed.length > 0 ? { failures: failed.map(({ success: _s, ...f }) => f) } : {}),
  };
}
