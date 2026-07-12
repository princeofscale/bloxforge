import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDistPath = join(__dirname, '../packages/core/dist');

async function main() {
  try {
    const { TOOL_DEFINITIONS } = await import(join(coreDistPath, 'tools/definitions.js'));

    let markdown = `# BloxForge MCP Tools Reference\n\n`;
    markdown += `This document contains the complete list of available MCP tools in BloxForge, automatically generated from the tool definitions.\n\n`;
    markdown += `## Total Tools: ${TOOL_DEFINITIONS.length}\n\n`;

    for (const tool of TOOL_DEFINITIONS) {
      markdown += `### \`${tool.name}\` (${tool.category === 'read' ? 'Read-only' : 'Write'})\n\n`;
      markdown += `${tool.description}\n\n`;
      if (tool.inputSchema && tool.inputSchema.properties) {
        markdown += `**Parameters:**\n\n`;
        markdown += `| Parameter | Type | Required | Description |\n`;
        markdown += `|---|---|---|---|\n`;
        const required = tool.inputSchema.required || [];
        for (const [propName, prop] of Object.entries(tool.inputSchema.properties)) {
          const isReq = required.includes(propName) ? 'Yes' : 'No';
          const desc = prop.description || '';
          markdown += `| \`${propName}\` | \`${prop.type}\` | ${isReq} | ${desc} |\n`;
        }
        markdown += `\n`;
      }
      markdown += `---\n\n`;
    }

    const outputPath = join(__dirname, '../docs/tools-reference.md');
    writeFileSync(outputPath, markdown, 'utf8');
    console.log(`Generated tools reference at: ${outputPath}`);
  } catch (err) {
    console.error('Failed to generate tool docs. Make sure you run `npm run build` first.', err);
    process.exit(1);
  }
}

main();
