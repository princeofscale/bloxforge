import {
  copyFileSync,
  createWriteStream,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { get } from 'node:https';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import type { IncomingMessage } from 'node:http';

const MAX_PLUGIN_BYTES = 50 * 1024 * 1024;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface PluginAssetIdentity {
  assetName: string;
  variant: 'main' | 'inspector';
  version: string;
}

export function validatePluginAsset(file: string, expected: PluginAssetIdentity): void {
  const size = statSync(file).size;
  if (size === 0 || size > MAX_PLUGIN_BYTES) {
    throw new Error(`${expected.assetName} must be between 1 and ${MAX_PLUGIN_BYTES} bytes`);
  }
  const source = readFileSync(file, 'utf8');
  if (!source.includes('<roblox') || !source.includes(`local PLUGIN_VARIANT = "${expected.variant}"`)) {
    throw new Error(`${expected.assetName} is not the expected ${expected.variant} Roblox plugin`);
  }
  if (!source.includes(`local CURRENT_VERSION = "${expected.version}"`)) {
    throw new Error(`${expected.assetName} does not contain expected version ${expected.version}`);
  }
}

export function pluginAssetsMatch(left: string, right: string): boolean {
  if (!existsSync(right)) return false;
  const leftBytes = readFileSync(left);
  const rightBytes = readFileSync(right);
  return leftBytes.length === rightBytes.length && leftBytes.equals(rightBytes);
}

function replaceValidatedTemporary(temporary: string, destination: string): void {
  if (process.platform !== 'win32' || !existsSync(destination)) {
    renameSync(temporary, destination);
    return;
  }

  const backup = `${destination}.${process.pid}.${randomUUID()}.bak`;
  renameSync(destination, backup);
  try {
    renameSync(temporary, destination);
    unlinkSync(backup);
  } catch (error) {
    if (existsSync(backup) && !existsSync(destination)) renameSync(backup, destination);
    throw error;
  }
}

export function installPluginAsset(
  source: string,
  destination: string,
  expected: PluginAssetIdentity,
): 'installed' | 'unchanged' {
  validatePluginAsset(source, expected);
  if (pluginAssetsMatch(source, destination)) return 'unchanged';

  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    copyFileSync(source, temporary);
    validatePluginAsset(temporary, expected);
    replaceValidatedTemporary(temporary, destination);
    return 'installed';
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // A successful rename consumed the temporary file.
    }
  }
}

function responseFor(url: string, userAgent: string, redirects = 0): Promise<IncomingMessage> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return Promise.reject(new Error('Plugin downloads require a credential-free HTTPS URL'));
  }

  return new Promise((resolve, reject) => {
    const request = get(parsed, { headers: { 'User-Agent': userAgent } }, response => {
      if (REDIRECTS.has(response.statusCode ?? 0)) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
          return;
        }
        const location = response.headers.location;
        if (!location) {
          reject(new Error('Redirect with no location header'));
          return;
        }
        responseFor(new URL(location, parsed).toString(), userAgent, redirects + 1).then(resolve, reject);
        return;
      }
      resolve(response);
    });
    request.once('error', reject);
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error(`Request timed out after ${TIMEOUT_MS}ms`)));
  });
}

function byteLimiter(limit: number): Transform {
  let received = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(
        received > limit ? new Error(`Download exceeded the ${limit}-byte limit`) : undefined,
        received > limit ? undefined : chunk,
      );
    },
  });
}

export async function fetchHttpsJson<T>(url: string, userAgent: string): Promise<T> {
  const response = await responseFor(url, userAgent);
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`GitHub API returned HTTP ${response.statusCode}`);
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of response) {
    const bytes = Buffer.from(chunk);
    received += bytes.length;
    if (received > MAX_JSON_BYTES) throw new Error(`JSON response exceeded the ${MAX_JSON_BYTES}-byte limit`);
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as T;
}

export async function downloadPluginAsset(
  url: string,
  destination: string,
  expected: PluginAssetIdentity,
  userAgent: string,
): Promise<void> {
  const response = await responseFor(url, userAgent);
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`Download failed: HTTP ${response.statusCode}`);
  }
  const contentLength = Number(response.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_PLUGIN_BYTES) {
    response.resume();
    throw new Error(`Download exceeded the ${MAX_PLUGIN_BYTES}-byte limit`);
  }

  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
  try {
    try {
      await pipeline(response, byteLimiter(MAX_PLUGIN_BYTES), output);
    } finally {
      output.destroy();
      await finished(output).catch(() => undefined);
    }
    validatePluginAsset(temporary, expected);
    replaceValidatedTemporary(temporary, destination);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // A successful rename consumed the temporary file.
    }
  }
}
