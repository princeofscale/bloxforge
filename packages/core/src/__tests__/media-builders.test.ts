import {
  assetUri,
  buildCreateSoundLuau,
  buildPlaySoundLuau,
  buildCreateAnimationLuau,
  buildPlayAnimationLuau,
  buildApplyTextureLuau,
} from '../builders/media-builders.js';

describe('assetUri', () => {
  it('wraps a numeric id in rbxassetid://', () => {
    expect(assetUri(12345)).toBe('rbxassetid://12345');
    expect(assetUri('678')).toBe('rbxassetid://678');
  });
  it('passes an existing uri through', () => {
    expect(assetUri('rbxassetid://9')).toBe('rbxassetid://9');
    expect(assetUri('http://www.roblox.com/asset/?id=9')).toBe('http://www.roblox.com/asset/?id=9');
  });
});

describe('buildCreateSoundLuau', () => {
  it('creates a Sound with a normalized SoundId and config', () => {
    const code = buildCreateSoundLuau({ parentPath: 'Workspace', soundId: 99, volume: 0.5, looped: true });
    expect(code).toContain('Instance.new("Sound")');
    expect(code).toContain('SoundId = "rbxassetid://99"');
    expect(code).toContain('Volume = 0.5');
    expect(code).toContain('Looped = true');
    expect(code).toContain('resolvePath');
  });
  it('plays on create when requested', () => {
    expect(buildCreateSoundLuau({ parentPath: 'Workspace', soundId: 1, playOnCreate: true })).toContain(':Play()');
  });
});

describe('buildPlaySoundLuau', () => {
  it('resolves and plays an existing sound', () => {
    const code = buildPlaySoundLuau({ path: 'Workspace.Ambience' });
    expect(code).toContain('resolvePath');
    expect(code).toContain(':Play()');
  });
});

describe('buildCreateAnimationLuau', () => {
  it('creates an Animation with a normalized AnimationId', () => {
    const code = buildCreateAnimationLuau({ parentPath: 'ReplicatedStorage', animationId: 777, name: 'Wave' });
    expect(code).toContain('Instance.new("Animation")');
    expect(code).toContain('AnimationId = "rbxassetid://777"');
    expect(code).toContain('"Wave"');
  });
});

describe('buildPlayAnimationLuau', () => {
  it('loads the animation onto a rig humanoid/animator and plays it', () => {
    const code = buildPlayAnimationLuau({ rigPath: 'Workspace.Dummy', animationId: 5 });
    expect(code).toContain('rbxassetid://5');
    expect(code).toMatch(/Animator|Humanoid|LoadAnimation/);
    expect(code).toContain(':Play()');
  });
});

describe('buildApplyTextureLuau', () => {
  it('applies an image to the right property based on class', () => {
    const code = buildApplyTextureLuau({ targetPath: 'StarterGui.Gui.Icon', assetId: 42 });
    expect(code).toContain('resolvePath');
    expect(code).toContain('rbxassetid://42');
    // It should branch on class to pick Image / Texture / Decal / TextureID.
    expect(code).toMatch(/ImageLabel|Decal|Texture|MeshPart/);
  });
  it('honors an explicit property override', () => {
    const code = buildApplyTextureLuau({ targetPath: 'Workspace.Part.Decal', assetId: 7, property: 'Texture' });
    expect(code).toContain('target.Texture = "rbxassetid://7"');
  });
});
