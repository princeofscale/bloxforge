#!/usr/bin/env node

/**
 * Removes files copied by prepack from the package directory after npm pack/publish.
 * Run from a publishable package directory via its "postpack" script.
 */

import { rmSync, existsSync } from 'fs';
import { join } from 'path';

const packageDir = process.cwd();
for (const name of ['studio-plugin', 'assets']) {
  const dest = join(packageDir, name);
  if (existsSync(dest)) {
    console.log(`Cleaning up ${name}/ from ${packageDir}`);
    rmSync(dest, { recursive: true, force: true });
  }
}
