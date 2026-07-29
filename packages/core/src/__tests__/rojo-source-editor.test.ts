import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RojoSourceEditor } from '../rojo/source-editor.js';

describe('Rojo source editor', () => {
  let root: string;
  let file: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-rojo-editor-'));
    process.env.BLOXFORGE_PROJECT_ROOT = root;
    file = path.join(root, 'src', 'Main.server.lua');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'print("old")\n');
  });

  afterEach(() => {
    delete process.env.BLOXFORGE_PROJECT_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('previews and applies an optimistic-lock patch atomically', () => {
    const editor = new RojoSourceEditor(root);
    const before = editor.read('src/Main.server.lua');
    const preview = editor.patch('src/Main.server.lua', {
      oldText: 'old',
      newText: 'new',
      expectedHash: before.contentHash,
      dryRun: true,
    });
    expect(preview.diff).toContain('-print("old")');
    expect(fs.readFileSync(file, 'utf8')).toContain('old');

    const applied = editor.patch('src/Main.server.lua', {
      oldText: 'old',
      newText: 'new',
      expectedHash: before.contentHash,
    });
    expect(applied.applied).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('new');
  });

  test('rejects stale hashes and ambiguous patches', () => {
    const editor = new RojoSourceEditor(root);
    expect(() => editor.patch('src/Main.server.lua', {
      oldText: 'old',
      newText: 'new',
      expectedHash: 'sha256:stale',
    })).toThrow(/content hash conflict/i);
    fs.writeFileSync(file, 'old old');
    expect(() => editor.patch('src/Main.server.lua', {
      oldText: 'old',
      newText: 'new',
      expectedHash: editor.read('src/Main.server.lua').contentHash,
    })).toThrow(/multiple locations/i);
  });

  test('creates only absent files and requires confirmation to delete with backup', () => {
    const editor = new RojoSourceEditor(root);
    expect(editor.create('src/New.lua', { content: 'return {}', dryRun: true }).applied).toBe(false);
    expect(editor.create('src/New.lua', { content: 'return {}', expectedAbsent: true }).applied).toBe(true);
    expect(() => editor.create('src/New.lua', { content: 'again', expectedAbsent: true })).toThrow(/already exists/);

    const current = editor.read('src/New.lua');
    expect(() => editor.delete('src/New.lua', {
      expectedHash: current.contentHash,
      confirm: false,
    })).toThrow(/confirmation required/i);
    const deleted = editor.delete('src/New.lua', {
      expectedHash: current.contentHash,
      confirm: true,
    });
    expect(deleted.applied).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(deleted.backupPath!)).toBe(true);
  });

  test('keeps the old file intact when the atomic rename is interrupted', () => {
    const editor = new RojoSourceEditor(root, () => {
      throw new Error('simulated rename interruption');
    });
    const before = editor.read('src/Main.server.lua');
    expect(() => editor.patch('src/Main.server.lua', {
      oldText: 'old',
      newText: 'new',
      expectedHash: before.contentHash,
    })).toThrow(/simulated rename interruption/);
    expect(fs.readFileSync(file, 'utf8')).toBe('print("old")\n');
    expect(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
