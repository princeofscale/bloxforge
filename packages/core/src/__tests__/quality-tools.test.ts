import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { QualityTools } from '../quality-tools.js';

jest.mock('node:child_process', () => ({
  execFileSync: jest.fn(),
}));

const exec = jest.mocked(execFileSync);

describe('QualityTools', () => {
  beforeEach(() => {
    exec.mockReset();
    exec.mockReturnValue('1.0.0' as never);
  });

  test('detects project manifests and reports optional tool availability', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-project-'));
    try {
      fs.writeFileSync(path.join(root, 'default.project.json'), '{}');
      fs.writeFileSync(path.join(root, 'wally.toml'), '[package]\nname = "demo"');
      const result = new QualityTools().detectRobloxProject(root);
      const canonicalRoot = fs.realpathSync(root);
      expect(result.root).toBe(canonicalRoot);
      expect(result.files).toMatchObject({
        'default.project.json': path.join(canonicalRoot, 'default.project.json'),
        'wally.toml': path.join(canonicalRoot, 'wally.toml'),
      });
      expect(Array.isArray(result.availableTools)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('detects an arbitrary Rojo project filename', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-project-'));
    try {
      fs.writeFileSync(path.join(root, 'arena.project.json'), '{"name":"Arena","tree":{}}');
      expect(new QualityTools().detectRobloxProject(root).files['arena.project.json'])
        .toBe(path.join(fs.realpathSync(root), 'arena.project.json'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('requires confirmation before package installation', () => {
    const result = new QualityTools().installWallyPackages(os.tmpdir(), false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/confirmation required/i);
  });

  test('rejects external tool outputs and scripts outside the project root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-quality-root-'));
    try {
      const tools = new QualityTools();
      fs.writeFileSync(path.join(root, 'default.project.json'), '{}');
      expect(tools.buildRojoProject(root, '../outside.rbxl').error).toMatch(/within project root/i);
      expect(tools.generateRojoSourcemap(root, '../sourcemap.json').error).toMatch(/within project root/i);
      expect(tools.runProjectTests(root, '../test.luau').error).toMatch(/within project root/i);
      expect(tools.validateWithLuauLsp(root, ['../outside.lua']).error).toMatch(/within project root/i);
      expect(tools.validateWithLuauLsp(root, ['/outside.lua']).error).toMatch(/within project root/i);
      expect(tools.validateWithLuauLsp(root, ['--definitions=outside']).error).toMatch(/option/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects symlinks that escape the project root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-quality-root-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-quality-outside-'));
    try {
      fs.writeFileSync(path.join(root, 'default.project.json'), '{}');
      fs.writeFileSync(path.join(outside, 'escaped.lua'), 'return true');
      fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      expect(new QualityTools().validateWithLuauLsp(root, ['linked/escaped.lua']).error)
        .toMatch(/within project root/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('passes validated absolute paths instead of option-shaped user input', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-quality-root-'));
    try {
      fs.writeFileSync(path.join(root, 'default.project.json'), '{}');
      fs.writeFileSync(path.join(root, 'script.lua'), 'return true');
      const result = new QualityTools().validateWithLuauLsp(root, ['script.lua']);
      expect(result.ok).toBe(true);
      const runCall = exec.mock.calls.find(([command, args]) =>
        command === 'luau-lsp' && Array.isArray(args) && args[0] === 'analyze');
      expect(runCall?.[1]).toContain(fs.realpathSync(path.join(root, 'script.lua')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['ETIMEDOUT', /timed out/i],
    ['ENOBUFS', /output limit/i],
  ])('returns a structured %s execution error', (code, message) => {
    // One spawn per quality call: the `--version` probe that used to run first
    // is gone, so the real invocation is the first mocked call now.
    exec.mockImplementationOnce(() => {
      throw Object.assign(new Error(code), { code, stdout: 'partial output' });
    });
    const result = new QualityTools().formatScriptPreview('return true');
    expect(result).toMatchObject({
      tool: 'stylua',
      available: true,
      ok: false,
      output: 'partial output',
      error: expect.stringMatching(message),
    });
  });

  test('reports a missing binary as unavailable, from the run itself', () => {
    // ENOENT from the real invocation is the same answer the separate probe
    // gave, one process cheaper and with no window for the tool to disappear
    // between "is it there" and "run it".
    exec.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    expect(new QualityTools().formatScriptPreview('return true')).toMatchObject({
      tool: 'stylua',
      available: false,
      ok: false,
      error: 'stylua is not installed',
    });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test('cleans validation temporary directories when a validator throws unexpectedly', () => {
    const temporaryDirectories = () => fs.readdirSync(os.tmpdir())
      .filter(name => name.startsWith('bloxforge-quality-'))
      .sort();
    const before = temporaryDirectories();
    exec.mockImplementation(() => {
      throw new Error('unexpected getter failure');
    });
    new QualityTools().validateScriptSource('return true');
    expect(temporaryDirectories()).toEqual(before);
  });
});
