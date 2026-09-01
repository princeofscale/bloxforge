import { createHash } from 'node:crypto';
import { BridgeService } from '../packages/core/dist/bridge-service.js';
import { TOOL_HANDLERS } from '../packages/core/dist/http-server.js';
import { RobloxStudioTools } from '../packages/core/dist/tools/index.js';
import { registerContractedTools } from '../packages/core/dist/tools/setup-registry.js';
import { ToolRegistry } from '../packages/core/dist/tools/tool-pipeline.js';

const EXPECTED_LEGACY_ONLY_HASH = 'da4ec8174b0920a255a0d3ef669c79c84037af600c9a1173bf5cd26363834e60';
const registry = new ToolRegistry();
registerContractedTools(registry, new RobloxStudioTools(new BridgeService('')));
const registered = new Set(registry.definitions.map(({ name }) => name));
const legacyOnly = Object.keys(TOOL_HANDLERS).filter((name) => !registered.has(name)).sort();
const hash = createHash('sha256').update(legacyOnly.join('\n')).digest('hex');
const report = {
  registryTools: registered.size,
  legacyHandlers: Object.keys(TOOL_HANDLERS).length,
  legacyOnly: legacyOnly.length,
  legacyOnlyHash: hash,
};

console.log(JSON.stringify(report));
if (process.argv.includes('--check') && hash !== EXPECTED_LEGACY_ONLY_HASH) {
  throw new Error('Legacy-only tool set changed. Migrate new tools through ToolRegistry and update the intentional baseline.');
}
