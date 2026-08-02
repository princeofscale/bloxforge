import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { get } from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  downloadPluginAsset,
  installPluginAsset,
  validatePluginAsset,
} from '../plugin-asset-installer.js';

jest.mock('node:https', () => ({ get: jest.fn() }));

const identity = {
  assetName: 'MCPPlugin.rbxmx',
  variant: 'main' as const,
  version: '3.0.0',
};
const validAsset = (version = '3.0.0', variant = 'main') =>
  `<?xml version="1.0"?><roblox><string>local CURRENT_VERSION = "${version}"\nlocal PLUGIN_VARIANT = "${variant}"</string></roblox>`;

function mockHttpsResponse(
  statusCode: number,
  body: string | Error,
  headers: Record<string, string> = {},
): void {
  (get as unknown as jest.Mock).mockImplementationOnce(
    (_url: URL, _options: unknown, callback: (response: PassThrough) => void) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: jest.Mock;
        destroy: (error: Error) => void;
      };
      request.setTimeout = jest.fn();
      request.destroy = (error: Error) => request.emit('error', error);

      const response = Object.assign(new PassThrough(), { statusCode, headers });
      queueMicrotask(() => {
        callback(response);
        if (body instanceof Error) response.destroy(body);
        else response.end(body);
      });
      return request;
    },
  );
}

describe('plugin asset installation', () => {
  afterEach(() => jest.clearAllMocks());

  test('installs atomically into paths containing spaces and no-ops for identical files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge plugin install '));
    try {
      const source = path.join(root, 'source.rbxmx');
      const destination = path.join(root, 'Plugin Folder', 'MCPPlugin.rbxmx');
      fs.mkdirSync(path.dirname(destination));
      fs.writeFileSync(source, validAsset());

      expect(installPluginAsset(source, destination, identity)).toBe('installed');
      const modified = fs.statSync(destination).mtimeMs;
      expect(installPluginAsset(source, destination, identity)).toBe('unchanged');
      expect(fs.statSync(destination).mtimeMs).toBe(modified);
      expect(fs.readdirSync(path.dirname(destination))).toEqual(['MCPPlugin.rbxmx']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    [validAsset('2.0.0'), /version 3\.0\.0/],
    [validAsset('3.0.0', 'inspector'), /expected main/],
    ['not xml', /expected main/],
  ])('rejects a mismatched asset without replacing the working plugin', (candidate, error) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-plugin-invalid-'));
    try {
      const source = path.join(root, 'candidate.rbxmx');
      const destination = path.join(root, 'MCPPlugin.rbxmx');
      fs.writeFileSync(source, candidate);
      fs.writeFileSync(destination, validAsset());
      expect(() => installPluginAsset(source, destination, identity)).toThrow(error);
      expect(fs.readFileSync(destination, 'utf8')).toBe(validAsset());
      expect(fs.readdirSync(root).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects empty and oversized plugin files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-plugin-size-'));
    try {
      const empty = path.join(root, 'empty.rbxmx');
      fs.writeFileSync(empty, '');
      expect(() => validatePluginAsset(empty, identity)).toThrow(/between 1/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('follows temporary redirects and installs a validated download', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-plugin-download-'));
    try {
      const destination = path.join(root, 'MCPPlugin.rbxmx');
      mockHttpsResponse(307, '', { location: 'https://downloads.example/plugin.rbxmx' });
      mockHttpsResponse(200, validAsset());

      await downloadPluginAsset('https://example.test/latest', destination, identity, 'test');

      expect(fs.readFileSync(destination, 'utf8')).toBe(validAsset());
      expect(get).toHaveBeenCalledTimes(2);
      expect(fs.readdirSync(root)).toEqual(['MCPPlugin.rbxmx']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['an interrupted response', {}, new Error('connection reset'), /connection reset/],
    [
      'an oversized response',
      { 'content-length': String(50 * 1024 * 1024 + 1) },
      '',
      /exceeded/,
    ],
  ])('preserves the working plugin after %s', async (_label, headers, body, error) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-plugin-failed-download-'));
    try {
      const destination = path.join(root, 'MCPPlugin.rbxmx');
      fs.writeFileSync(destination, validAsset());
      mockHttpsResponse(200, body, headers);

      await expect(
        downloadPluginAsset('https://example.test/plugin.rbxmx', destination, identity, 'test'),
      ).rejects.toThrow(error);
      expect(fs.readFileSync(destination, 'utf8')).toBe(validAsset());
      expect(fs.readdirSync(root)).toEqual(['MCPPlugin.rbxmx']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // Windows permission semantics differ, and UID 0 bypasses directory mode
  // bits. Neither environment can prove the EACCES cleanup path with chmod.
  const canEnforceReadOnlyDirectory = process.platform !== 'win32' &&
    (typeof process.getuid !== 'function' || process.getuid() !== 0);
  (canEnforceReadOnlyDirectory ? test : test.skip)(
    'cleans temporary files when the destination directory is read-only',
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-plugin-readonly-'));
      const source = path.join(root, 'candidate.rbxmx');
      const destinationDir = path.join(root, 'readonly');
      const destination = path.join(destinationDir, 'MCPPlugin.rbxmx');
      fs.writeFileSync(source, validAsset());
      fs.mkdirSync(destinationDir, { mode: 0o500 });
      try {
        expect(() => installPluginAsset(source, destination, identity)).toThrow();
        expect(fs.readdirSync(destinationDir)).toEqual([]);
      } finally {
        fs.chmodSync(destinationDir, 0o700);
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
