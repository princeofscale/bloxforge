// The packs that ship with BloxForge.
//
// Registration is a module-load side effect on purpose: the pack registry is
// process-global while `registerIntegrationTools` runs once per ToolRegistry,
// and registering there would throw the second time a server was constructed.
//
// `BUILTIN_PACKS` is exported so a test that clears the registry can put them
// back without importing each pack by hand.

import { registerPack, type IntegrationPack } from './pack.js';
import { ROBLOX_TS_PACK } from './packs/roblox-ts.js';

export const BUILTIN_PACKS: readonly IntegrationPack[] = [ROBLOX_TS_PACK];

for (const pack of BUILTIN_PACKS) registerPack(pack);
