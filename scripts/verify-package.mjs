import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function run(command, cwd) {
  console.log(`> [${cwd || '.'}] ${command}`);
  try {
    return execSync(command, { cwd: cwd || rootDir, stdio: 'pipe', encoding: 'utf-8' });
  } catch (err) {
    console.error(`Command failed: ${command}`);
    console.error(`STDOUT:\n${err.stdout}`);
    console.error(`STDERR:\n${err.stderr}`);
    process.exit(1);
  }
}

async function verify() {
  console.log('--- Verifying BloxForge Packages ---');

  // Ensure builds are fresh
  console.log('\n[1/5] Building packages...');
  run('npm run build');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-verify-'));
  console.log(`\n[2/5] Creating temporary workspace at ${tempDir}...`);

  try {
    // Pack core
    console.log('\n[3/5] Packing @princeofscale/bloxforge-core...');
    const corePackOutput = run('npm pack', path.join(rootDir, 'packages', 'core'));
    const coreTarball = corePackOutput.trim().split('\n').pop();
    const coreTarballPath = path.join(rootDir, 'packages', 'core', coreTarball);

    // Pack cli
    console.log('\n[3/5] Packing @princeofscale/bloxforge...');
    const cliPackOutput = run('npm pack', path.join(rootDir, 'packages', 'robloxstudio-mcp'));
    const cliTarball = cliPackOutput.trim().split('\n').pop();
    const cliTarballPath = path.join(rootDir, 'packages', 'robloxstudio-mcp', cliTarball);

    // Initialize temp project
    run('npm init -y', tempDir);

    // Install them
    console.log('\n[4/5] Installing packed tarballs into temporary workspace...');
    run(`npm install ${coreTarballPath} ${cliTarballPath} --no-save`, tempDir);

    // Verify
    console.log('\n[5/5] Running smoke tests on installed packages...');

    // 1. Verify Core can be imported
    const testCoreScript = path.join(tempDir, 'test-core.mjs');
    fs.writeFileSync(testCoreScript, `
      import { BloxForgeServer } from '@princeofscale/bloxforge-core';
      if (!BloxForgeServer) throw new Error("Could not import BloxForgeServer");
      console.log("Core import OK.");
    `);
    run(`node test-core.mjs`, tempDir);

    // 2. Verify CLI executes with --help
    const testCliScript = path.join(tempDir, 'test-cli.mjs');
    fs.writeFileSync(testCliScript, `
      import { execSync } from 'child_process';
      try {
        const out = execSync('npx bloxforge --help', { encoding: 'utf8' });
        if (!out.includes('BloxForge MCP Server')) {
          throw new Error("CLI output did not contain expected text");
        }
        console.log("CLI execution OK.");
      } catch (err) {
        console.error("CLI test failed.");
        process.exit(1);
      }
    `);
    run(`node test-cli.mjs`, tempDir);

    console.log('\n✅ Verification successful! Packages are release-ready.');
  } finally {
    // Cleanup
    console.log(`\nCleaning up ${tempDir}...`);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

verify().catch(err => {
  console.error('\n❌ Verification failed:', err);
  process.exit(1);
});
