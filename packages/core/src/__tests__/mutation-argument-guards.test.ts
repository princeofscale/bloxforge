import { MutationTools } from '../tools/mutation-tools.js';

// Every mutating tool refuses a call that is missing a required argument, and
// the refusal names the argument. check-argument-errors.mjs already proves the
// wording is a named parameter rather than prose; nothing proved the guard
// actually fires. That distinction is not academic — a guard's condition has
// been broken in this repo before while its message stayed perfectly correct.
//
// The bridge here throws on contact, so a guard that failed to fire would reach
// it and fail the test with a different error than the one asserted.

function tools() {
  return new MutationTools({
    callSingle: async () => { throw new Error('the guard let the call through to the bridge'); },
    safetyGate: () => undefined,
    recordOperation: () => undefined,
  } as never);
}

type Case = [name: string, call: (t: MutationTools) => Promise<unknown>, expected: RegExp];

const cases: Case[] = [
  ['set_property', (t) => t.setProperty('', 'Anchored', true), /instancePath and propertyName are required for set_property/],
  ['set_property (no property)', (t) => t.setProperty('game.Workspace.Part', '', true), /instancePath and propertyName/],
  ['set_properties', (t) => t.setProperties('', {}), /instancePath and properties are required for set_properties/],
  ['mass_set_property', (t) => t.massSetProperty([], 'Anchored', true), /paths \(non-empty\) and propertyName are required for mass_set_property/],
  ['mass_get_property', (t) => t.massGetProperty([], 'Anchored'), /paths \(non-empty\) and propertyName are required for mass_get_property/],
  ['create_object', (t) => t.createObject('', 'game.Workspace'), /className and parent are required for create_object/],
  ['create_object (no parent)', (t) => t.createObject('Part', ''), /className and parent are required/],
  ['mass_create_objects', (t) => t.massCreateObjects([]), /objects \(non-empty array\) is required for mass_create_objects/],
  ['delete_object', (t) => t.deleteObject(''), /instancePath is required for delete_object/],
  ['mass_delete_objects', (t) => t.massDeleteObjects([]), /paths \(non-empty array\) is required for mass_delete_objects/],
  ['clone_object', (t) => t.cloneObject('', 'game.Workspace'), /instancePath and targetParentPath are required for clone_object/],
  ['smart_duplicate', (t) => t.smartDuplicate('game.Workspace.Part', 0), /instancePath and count \(> 0\) are required for smart_duplicate/],
  ['mass_duplicate', (t) => t.massDuplicate([]), /duplications \(non-empty array\) is required for mass_duplicate/],
  ['set_attribute', (t) => t.setAttribute('', 'Speed', 1), /instancePath and attributeName are required for set_attribute/],
  ['get_attributes', (t) => t.getAttributes(''), /instancePath is required for get_attributes/],
  ['delete_attribute', (t) => t.deleteAttribute('game.Workspace.Part', ''), /instancePath and attributeName are required for delete_attribute/],
  ['bulk_set_attributes', (t) => t.bulkSetAttributes('', {}), /instancePath and attributes are required for bulk_set_attributes/],
  ['get_tags', (t) => t.getTags(''), /instancePath is required for get_tags/],
  ['add_tag', (t) => t.addTag('game.Workspace.Part', ''), /instancePath and tagName are required for add_tag/],
  ['remove_tag', (t) => t.removeTag('game.Workspace.Part', ''), /instancePath and tagName are required for remove_tag/],
  ['get_tagged', (t) => t.getTagged(''), /tagName is required for get_tagged/],
];

describe('mutating tools refuse incomplete calls before reaching the bridge', () => {
  it.each(cases)('%s', async (_name, call, expected) => {
    await expect(call(tools())).rejects.toThrow(expected);
  });

  it('accepts a complete call, so the guards are not simply refusing everything', async () => {
    const seen: Array<{ endpoint: string }> = [];
    const permissive = new MutationTools({
      callSingle: async (endpoint: string) => { seen.push({ endpoint }); return { ok: true }; },
      safetyGate: () => undefined,
      recordOperation: () => undefined,
    } as never);
    await permissive.setProperty('game.Workspace.Part', 'Anchored', true);
    expect(seen[0].endpoint).toBe('/api/set-property');
  });
});
