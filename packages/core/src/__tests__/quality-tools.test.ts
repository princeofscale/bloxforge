import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { QualityTools } from '../quality-tools.js';

describe('QualityTools', () => {
  test('detects project manifests and reports optional tool availability', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-project-'));
    fs.writeFileSync(path.join(root, 'default.project.json'), '{}');
    fs.writeFileSync(path.join(root, 'wally.toml'), '[package]\nname = "demo"');
    const result = new QualityTools().detectRobloxProject(root);
    expect(result.root).toBe(root);
    expect(result.files).toMatchObject({
      'default.project.json': path.join(root, 'default.project.json'),
      'wally.toml': path.join(root, 'wally.toml'),
    });
    expect(Array.isArray(result.availableTools)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('requires confirmation before package installation', () => {
    const result = new QualityTools().installWallyPackages(os.tmpdir(), false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/confirmation required/i);
  });

  test('rejects external tool outputs and scripts outside the project root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-quality-root-'));
    const tools = new QualityTools();
    fs.writeFileSync(path.join(root, 'default.project.json'), '{}');
    expect(tools.buildRojoProject(root, '../outside.rbxl').error).toMatch(/within project root/i);
    expect(tools.generateRojoSourcemap(root, '../sourcemap.json').error).toMatch(/within project root/i);
    expect(tools.runProjectTests(root, '../test.luau').error).toMatch(/within project root/i);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
