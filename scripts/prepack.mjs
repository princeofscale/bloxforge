#!/usr/bin/env node

/**
 * Copies studio-plugin/ into the package directory before npm pack/publish.
 * Run from a publishable package directory via its "prepack" script.
 */

import { cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const packageDir = process.cwd();
const rootDir = join(packageDir, '..', '..');
const copies = [
  ['studio-plugin', 'studio-plugin'],
  ['packages/core/assets', 'assets'],
];

for (const [sourceRel, destRel] of copies) {
  const source = join(rootDir, sourceRel);
  const dest = join(packageDir, destRel);
  if (!existsSync(source)) {
    console.error(`${sourceRel}/ not found at project root, skipping copy`);
    continue;
  }
  if (existsSync(dest)) {
    console.log(`${destRel}/ already exists in package, skipping copy`);
    continue;
  }
  console.log(`Copying ${sourceRel}/ into ${packageDir}/${destRel}`);
  cpSync(source, dest, { recursive: true });
}
