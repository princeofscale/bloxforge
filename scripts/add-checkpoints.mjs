import fs from 'node:fs';
import path from 'node:path';

const checkpointLine = 'if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end';

function addCheckpoint(file, patterns) {
    const filePath = path.join('/Users/princeofscale/Desktop/robloxstudio-mcp/packages/core/src/builders', file);
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    for (const pattern of patterns) {
        if (content.includes(pattern.target)) {
            const replaceWith = `${pattern.target}\n${pattern.indent}${checkpointLine}`;
            if (!content.includes(replaceWith)) {
                content = content.replace(pattern.target, replaceWith);
                changed = true;
            }
        }
    }

    if (changed) {
        fs.writeFileSync(filePath, content);
        console.log(`Updated ${file}`);
    }
}

addCheckpoint('terrain-builders.ts', [
    { target: 'for gx = 0, ${luaNumber(ex)}, res do', indent: '\t' },
    { target: 'game.Workspace.Terrain:FillBlock(size, position, targetMaterial)', indent: '\t\t' },
    { target: 'game.Workspace.Terrain:WriteVoxels(region, 4, materialArr, occupancyArr)', indent: '\t\t' },
    { target: 'game.Workspace.Terrain:Clear()', indent: '\t\t' }
]);

addCheckpoint('design-builders.ts', [
    { target: 'for _, descendant in ipairs(instances) do', indent: '\t\t' },
    { target: 'for _, descendant in ipairs(instancesToScan) do', indent: '\t\t\t' }
]);

addCheckpoint('scene-search.ts', [
    { target: 'for _, d in ipairs(root:GetDescendants()) do', indent: '\t\t' }
]);

addCheckpoint('world-model.ts', [
    { target: 'for _, d in ipairs(root:GetDescendants()) do', indent: '\t\t' }
]);

addCheckpoint('template-builders.ts', [
    { target: 'for i = 0, NUM_CHECKPOINTS do', indent: '\t\t' },
    { target: 'for i = 1, NUM_TELEPORTS do', indent: '\t\t' }
]);

console.log('Checkpoints added.');
