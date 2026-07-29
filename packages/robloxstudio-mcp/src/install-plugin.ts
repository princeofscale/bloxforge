import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  downloadPluginAsset,
  fetchHttpsJson,
  getPluginsFolder,
  handleVariantConflict,
  installPluginAsset,
  validatePluginAsset,
} from '@princeofscale/bloxforge-core';

const REPO = 'princeofscale/bloxforge';
const ASSET_NAME = 'MCPPlugin.rbxmx';
const OTHER_VARIANT = 'MCPInspectorPlugin.rbxmx';
const USER_AGENT = 'bloxforge';

interface InstallOptions {
  dev?: boolean;
  replaceVariant?: boolean;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

async function findDevRelease(): Promise<{ tag_name: string; assets: { name: string; browser_download_url: string }[] }> {
  const releases = await fetchHttpsJson<{
    tag_name: string;
    prerelease: boolean;
    assets: { name: string; browser_download_url: string }[];
  }[]>(`https://api.github.com/repos/${REPO}/releases?per_page=20`, USER_AGENT);
  const prerelease = releases.find(
    (r) => r.prerelease && r.assets.some((a) => a.name === ASSET_NAME),
  );
  if (!prerelease) {
    throw new Error(`No prerelease found with ${ASSET_NAME}`);
  }
  return prerelease;
}

function prepareInstall(): string {
  const pluginsFolder = getPluginsFolder();

  if (!existsSync(pluginsFolder)) {
    mkdirSync(pluginsFolder, { recursive: true });
  }

  return pluginsFolder;
}

function bundledAssetPath(): string | null {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(currentDir, '..', 'studio-plugin', ASSET_NAME),
    join(currentDir, '..', '..', '..', 'studio-plugin', ASSET_NAME),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function packageVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(currentDir, '..', 'package.json'), 'utf8')) as { version?: string };
  if (!pkg.version) {
    throw new Error('Package version not found');
  }
  return pkg.version;
}

function assertBundledPluginVersion(source: string): void {
  const expected = packageVersion();
  try {
    validatePluginAsset(source, { assetName: ASSET_NAME, variant: 'main', version: expected });
  } catch {
    throw new Error(
      `Bundled ${ASSET_NAME} does not match package version ${expected}. ` +
      'Run npm run build:plugin before starting with --auto-install-plugin.',
    );
  }
}

function resolveVariantConflict(pluginsFolder: string, options: InstallOptions): void {
  handleVariantConflict({
    pluginsFolder,
    otherAssetName: OTHER_VARIANT,
    replace: options.replaceVariant ?? true,
    log: options.log ?? console.log,
    warn: options.warn ?? console.warn,
  });
}

export async function installBundledPlugin(options: InstallOptions = {}): Promise<void> {
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;
  const replaceVariant = options.replaceVariant ?? true;
  const source = bundledAssetPath();
  if (!source) {
    throw new Error(`Bundled ${ASSET_NAME} not found in package`);
  }
  assertBundledPluginVersion(source);

  const pluginsFolder = prepareInstall();
  const dest = join(pluginsFolder, ASSET_NAME);
  const result = installPluginAsset(source, dest, {
    assetName: ASSET_NAME,
    variant: 'main',
    version: packageVersion(),
  });
  resolveVariantConflict(pluginsFolder, { replaceVariant, log, warn });
  if (result === 'installed') log(`Installed ${ASSET_NAME} to ${dest}`);
}

export async function installPlugin(options: InstallOptions = {}): Promise<void> {
  const dev = options.dev ?? process.argv.includes('--dev');
  const replaceVariant = options.replaceVariant ?? true;
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;
  const pluginsFolder = prepareInstall();
  const bundled = bundledAssetPath();

  if (bundled) {
    assertBundledPluginVersion(bundled);
    const dest = join(pluginsFolder, ASSET_NAME);
    const result = installPluginAsset(bundled, dest, {
      assetName: ASSET_NAME,
      variant: 'main',
      version: packageVersion(),
    });
    resolveVariantConflict(pluginsFolder, { replaceVariant, log, warn });
    if (result === 'unchanged') {
      log(`${ASSET_NAME} already installed.`);
      return;
    }
    log(`Installed bundled ${ASSET_NAME} to ${dest}`);
    return;
  }

  log(dev ? 'Fetching latest dev prerelease...' : 'Fetching latest release...');
  const release = dev
    ? await findDevRelease()
    : await fetchHttpsJson<{
        tag_name: string;
        assets: { name: string; browser_download_url: string }[];
      }>(`https://api.github.com/repos/${REPO}/releases/latest`, USER_AGENT);

  const asset = release.assets?.find((a) => a.name === ASSET_NAME);
  if (!asset) {
    throw new Error(`${ASSET_NAME} not found in release ${release.tag_name}`);
  }

  const dest = join(pluginsFolder, ASSET_NAME);
  log(`Downloading ${ASSET_NAME} from ${release.tag_name}...`);
  await downloadPluginAsset(asset.browser_download_url, dest, {
    assetName: ASSET_NAME,
    variant: 'main',
    version: release.tag_name.replace(/^v/, ''),
  }, USER_AGENT);
  resolveVariantConflict(pluginsFolder, { replaceVariant, log, warn });
  log(`Installed to ${dest}`);
}
