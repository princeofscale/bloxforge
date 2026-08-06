import {
  buildObbyTemplateLuau,
  buildSimulatorTemplateLuau,
  buildTycoonTemplateLuau,
  buildRoundTemplateLuau,
} from '../builders/template-builders.js';
import { buildDayNightCycleScriptLuau } from '../builders/environment-builders.js';

// Everything these builders emit is sent to /api/execute-luau and runs in the
// plugin's edit context. None of them declares `studio.execute`, which is what
// the `builder` profile filters on and what the execute_luau safety gate is
// attached to — so a caller-supplied value that escapes its literal is
// arbitrary code execution through a tool that promises none of it.
//
// The payloads below are the two shapes that actually worked: a string that
// closes its own quote, and a "number" that was never a number.

// The marker is a call, not a print of a string: a string marker vanishes with
// the literals when they are stripped, which made the detector blind.
const CLOSES_A_STRING = 'Coins" INJECTED() --';
const CLOSES_A_LONG_BRACKET = ']==] INJECTED() local x = [==[';
const NOT_A_NUMBER = '0 INJECTED() local z = 0';

/**
 * The marker must not survive as code. It may appear inside a quoted Luau
 * string — that is the escaping working — so this looks for it unquoted.
 */
function executesMarker(code: string): boolean {
  // Drop well-formed double-quoted literals; whatever is left is code.
  return /INJECTED\(\)/.test(code.replace(/"(?:[^"\\]|\\.)*"/g, '""'));
}

describe('generated Luau cannot be escaped by caller input', () => {
  it('a currency name cannot close the string it is placed in', () => {
    const code = buildSimulatorTemplateLuau({ currencyName: CLOSES_A_STRING });
    expect(executesMarker(code)).toBe(false);
  });

  it('a script name cannot close the long-bracket literal holding a script Source', () => {
    const code = buildDayNightCycleScriptLuau({ scriptName: CLOSES_A_LONG_BRACKET });
    expect(executesMarker(code)).toBe(false);
  });

  it.each([
    ['tycoon startingCash', () => buildTycoonTemplateLuau({ startingCash: NOT_A_NUMBER as never })],
    ['tycoon buttonPrice', () => buildTycoonTemplateLuau({ buttonPrice: NOT_A_NUMBER as never })],
    ['round roundSeconds', () => buildRoundTemplateLuau({ roundSeconds: NOT_A_NUMBER as never })],
    ['round intermissionSeconds', () => buildRoundTemplateLuau({ intermissionSeconds: NOT_A_NUMBER as never })],
    ['round teleportPoints', () => buildRoundTemplateLuau({ teleportPoints: NOT_A_NUMBER as never })],
    ['obby checkpoints', () => buildObbyTemplateLuau({ checkpoints: NOT_A_NUMBER as never })],
    ['day-night minutesPerDay', () => buildDayNightCycleScriptLuau({ minutesPerDay: NOT_A_NUMBER as never })],
  ])('%s is a number or nothing, never code', (_label, build) => {
    expect(executesMarker(build())).toBe(false);
  });

  it('still emits the values it was given when they are legitimate', () => {
    expect(buildTycoonTemplateLuau({ startingCash: 250 })).toContain('cash.Value = 250');
    expect(buildRoundTemplateLuau({ roundSeconds: 45 })).toContain('ROUND_SECONDS = 45');
    expect(buildSimulatorTemplateLuau({ currencyName: 'Gems' })).toContain('"Gems"');
  });

  it('the detector itself recognises an escape, so a green suite means something', () => {
    expect(executesMarker('local x = "a" INJECTED()')).toBe(true);
    expect(executesMarker('local x = "INJECTED()"')).toBe(false);
  });
});
