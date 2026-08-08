// What the advertised tool list costs the model. The list is re-sent on every
// request, so this is a recurring per-turn cost, not a one-off — and until it
// was measured, every claim about token efficiency here was an opinion.
//
// `--check` guards the always-on core set against silent growth. Adding a tool
// to CORE_TOOLS taxes every request of every session, including the ones that
// never use it, so that number is a budget rather than a statistic.

import { TOOL_DEFINITIONS } from '../packages/core/dist/tools/definitions.js';
import {
  CORE_TOOLS,
  TOOL_DOMAINS,
  approxToolTokens,
  toolsetTokenCost,
  tokenCostOf,
} from '../packages/core/dist/tools/tool-catalog.js';

// Ceiling, not a target. Raise it deliberately, with the reason in the commit.
const CORE_TOKEN_BUDGET = 6000;

const full = tokenCostOf(TOOL_DEFINITIONS, new Set(TOOL_DEFINITIONS.map((d) => d.name)));
const core = tokenCostOf(TOOL_DEFINITIONS, CORE_TOOLS);
const byDomain = toolsetTokenCost(TOOL_DEFINITIONS);

const report = {
  tools: TOOL_DEFINITIONS.length,
  fullCatalogTokens: full,
  coreTokens: core,
  coreTokenBudget: CORE_TOKEN_BUDGET,
  lazySavingPercent: Math.round((1 - core / full) * 100),
  byDomain: Object.fromEntries(TOOL_DOMAINS.map((d) => [d, byDomain[d] ?? 0])),
  heaviestTools: TOOL_DEFINITIONS
    .map((d) => ({ name: d.name, tokens: approxToolTokens(d) }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10),
};

console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--check') && core > CORE_TOKEN_BUDGET) {
  throw new Error(
    `Core tool schemas cost ~${core} tokens, over the ${CORE_TOKEN_BUDGET} budget. ` +
    'Every session pays this on every request. Move the tool into a domain toolset, ' +
    'trim its schema, or raise the budget deliberately.',
  );
}
