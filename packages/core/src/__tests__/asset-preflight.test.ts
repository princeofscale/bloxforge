import { buildAssetPreflightLuau } from '../builders/asset-preflight.js';

describe('buildAssetPreflightLuau', () => {
  it('loads via AssetService:LoadAssetAsync in a pcall', () => {
    const code = buildAssetPreflightLuau(123);
    expect(code).toContain('game:GetService("AssetService")');
    expect(code).toContain('AssetService:LoadAssetAsync(assetId)');
    expect(code).toContain('pcall(function()');
    expect(code).toContain('local assetId = 123');
  });

  it('returns a "no" verdict with the error when the load fails', () => {
    const code = buildAssetPreflightLuau(123);
    expect(code).toContain('res.insertabilityVerdict = "no"');
    expect(code).toContain('res.error = tostring(modelOrErr)');
  });

  it('inspects scripts and roots on success, then destroys the isolated container', () => {
    const code = buildAssetPreflightLuau(123);
    expect(code).toContain('d:IsA("LuaSourceContainer")');
    expect(code).toContain('res.hasScripts = scriptCount > 0');
    expect(code).toContain('res.insertabilityVerdict = "yes"');
    expect(code).toContain('container:Destroy()');
  });

  it('floors the asset id (never injects a non-integer)', () => {
    expect(buildAssetPreflightLuau(4893246329.9)).toContain('local assetId = 4893246329');
  });
});
