import * as fs from 'fs';
import * as path from 'path';
import { defaultManagedInstanceRegistryDir } from '../managed-instance-registry.js';
import { AssetTools } from '../tools/asset-tools.js';
import { RobloxStudioTools } from '../tools/index.js';

jest.mock('fs', () => {
  const original = jest.requireActual('fs');
  return {
    ...original,
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    accessSync: jest.fn(),
    statSync: jest.fn().mockImplementation((p: string) => ({
      isDirectory: () => p.includes('.bloxforge') || p.includes('.robloxstudio-mcp') || p.includes('custom/library'),
    })),
  };
});

describe('Legacy migration', () => {
  const originalEnv = { ...process.env };
  const mockExistsSync = fs.existsSync as jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    mockExistsSync.mockReset();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('defaultManagedInstanceRegistryDir', () => {
    it('prefers new env var override', () => {
      process.env.BLOXFORGE_MANAGED_INSTANCE_REGISTRY_DIR = '/custom/bf/path';
      process.env.ROBLOXSTUDIO_MCP_MANAGED_INSTANCE_REGISTRY_DIR = '/custom/rsmcp/path';
      expect(defaultManagedInstanceRegistryDir()).toBe('/custom/bf/path');
    });

    it('falls back to old env var override', () => {
      delete process.env.BLOXFORGE_MANAGED_INSTANCE_REGISTRY_DIR;
      process.env.ROBLOXSTUDIO_MCP_MANAGED_INSTANCE_REGISTRY_DIR = '/custom/rsmcp/path';
      expect(defaultManagedInstanceRegistryDir()).toBe('/custom/rsmcp/path');
    });

    it('uses new bloxforge path on fresh installation (neither exists)', () => {
      mockExistsSync.mockReturnValue(false);
      const dir = defaultManagedInstanceRegistryDir();
      expect(dir).toContain('bloxforge');
      expect(dir).not.toContain('robloxstudio-mcp');
    });

    it('falls back to legacy dir if only legacy dir exists', () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p.includes('robloxstudio-mcp');
      });
      const dir = defaultManagedInstanceRegistryDir();
      expect(dir).toContain('robloxstudio-mcp');
      expect(dir).not.toContain('bloxforge');
    });

    it('prefers new bloxforge dir if both exist', () => {
      mockExistsSync.mockReturnValue(true);
      const dir = defaultManagedInstanceRegistryDir();
      expect(dir).toContain('bloxforge');
      expect(dir).not.toContain('robloxstudio-mcp');
    });
  });

  describe('findLibraryPath', () => {
    it('respects BLOXFORGE_BUILD_LIBRARY env var override', () => {
      process.env.BLOXFORGE_BUILD_LIBRARY = '/custom/library/bf';
      process.env.ROBLOXSTUDIO_MCP_BUILD_LIBRARY = '/custom/library/rsmcp';
      
      (AssetTools as any)._cachedLibraryPath = undefined;
      (RobloxStudioTools as any)._cachedLibraryPath = undefined;

      const assetPath = (AssetTools as any).findLibraryPath();
      expect(assetPath).toBe(path.resolve('/custom/library/bf'));

      const corePath = (RobloxStudioTools as any).findLibraryPath();
      expect(corePath).toBe(path.resolve('/custom/library/bf'));
    });

    it('falls back to ROBLOXSTUDIO_MCP_BUILD_LIBRARY env var override', () => {
      delete process.env.BLOXFORGE_BUILD_LIBRARY;
      process.env.ROBLOXSTUDIO_MCP_BUILD_LIBRARY = '/custom/library/rsmcp';

      (AssetTools as any)._cachedLibraryPath = undefined;
      (RobloxStudioTools as any)._cachedLibraryPath = undefined;
      
      const assetPath = (AssetTools as any).findLibraryPath();
      expect(assetPath).toBe(path.resolve('/custom/library/rsmcp'));
    });

    it('uses new home library path if neither exists', () => {
      delete process.env.BLOXFORGE_BUILD_LIBRARY;
      delete process.env.ROBLOXSTUDIO_MCP_BUILD_LIBRARY;
      delete process.env.BUILD_LIBRARY_PATH;
      mockExistsSync.mockReturnValue(false);

      (AssetTools as any)._cachedLibraryPath = undefined;
      (RobloxStudioTools as any)._cachedLibraryPath = undefined;

      const assetPath = (AssetTools as any).findLibraryPath();
      expect(assetPath).toContain('.bloxforge');
      expect(assetPath).not.toContain('.robloxstudio-mcp');

      const corePath = (RobloxStudioTools as any).findLibraryPath();
      expect(corePath).toContain('.bloxforge');
      expect(corePath).not.toContain('.robloxstudio-mcp');
    });

    it('falls back to legacy home library path if legacy exists', () => {
      delete process.env.BLOXFORGE_BUILD_LIBRARY;
      delete process.env.ROBLOXSTUDIO_MCP_BUILD_LIBRARY;
      delete process.env.BUILD_LIBRARY_PATH;
      
      mockExistsSync.mockImplementation((p: string) => {
        return p.includes('.robloxstudio-mcp');
      });

      (AssetTools as any)._cachedLibraryPath = undefined;
      (RobloxStudioTools as any)._cachedLibraryPath = undefined;

      const assetPath = (AssetTools as any).findLibraryPath();
      expect(assetPath).toContain('.robloxstudio-mcp');
      expect(assetPath).not.toContain('.bloxforge');

      const corePath = (RobloxStudioTools as any).findLibraryPath();
      expect(corePath).toContain('.robloxstudio-mcp');
      expect(corePath).not.toContain('.bloxforge');
    });
  });
});
