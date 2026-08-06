import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDistPath = join(__dirname, '../packages/core/dist');
const outputPath = join(__dirname, '../docs/tools-reference.md');
const architecturePath = join(__dirname, '../docs/architecture.md');

function schemaType(schema) {
  if (schema.type) return Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type;
  const variants = schema.oneOf || schema.anyOf;
  return variants ? [...new Set(variants.map(schemaType))].join(' | ') : 'any';
}

function tableCell(value) {
  return String(value ?? '').replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
}

async function main() {
  try {
    const definitionsUrl = pathToFileURL(join(coreDistPath, 'tools/definitions.js')).href;
    const { TOOL_DEFINITIONS } = await import(definitionsUrl);

    let markdown = `# BloxForge MCP Tools Reference\n\n`;
    markdown += `This document contains the complete list of available MCP tools in BloxForge, automatically generated from the tool definitions.\n\n`;
    markdown += `## Total Tools: ${TOOL_DEFINITIONS.length}\n\n`;

    for (const tool of TOOL_DEFINITIONS) {
      markdown += `### \`${tool.name}\` (${tool.category === 'read' ? 'Read-only' : 'Write'})\n\n`;
      markdown += `${tool.description}\n\n`;
      const properties = tool.inputSchema?.properties;
      if (properties && Object.keys(properties).length > 0) {
        markdown += `**Parameters:**\n\n`;
        markdown += `| Parameter | Type | Required | Description |\n`;
        markdown += `|---|---|---|---|\n`;
        const required = tool.inputSchema.required || [];
        for (const [propName, prop] of Object.entries(properties)) {
          const isReq = required.includes(propName) ? 'Yes' : 'No';
          markdown += `| \`${tableCell(propName)}\` | \`${tableCell(schemaType(prop))}\` | ${isReq} | ${tableCell(prop.description)} |\n`;
        }
        markdown += `\n`;
      }
      markdown += `---\n\n`;
    }
    markdown = `${markdown.trimEnd()}\n`;

    if (process.argv.includes('--check')) {
      assert.equal(schemaType({ anyOf: [{ type: 'string' }, { type: 'number' }] }), 'string | number');
      assert.equal(tableCell('one|two\nthree'), 'one\\|two<br>three');
      // Compare content, not line endings. The generator writes LF; on a
      // Windows checkout git rewrites the working copy to CRLF, so a raw
      // comparison reported "out of date" on a file that had not changed —
      // regenerating then produced a whitespace-only diff to commit. Real
      // content drift still fails, exactly as before.
      const normalize = (value) => value.replace(/\r\n?/g, '\n');
      if (normalize(readFileSync(outputPath, 'utf8')) !== normalize(markdown)) {
        throw new Error('Generated tool docs are out of date.');
      }
      // docs/architecture.md states the tool count by hand. It went stale inside
      // the very branch that corrected it, because adding a tool does not touch
      // the file that names how many there are. Check it against the source of
      // truth rather than against whoever last remembered.
      const architecture = readFileSync(architecturePath, 'utf8');
      const stated = architecture.match(/Tool handlers \((\d+) tools\)/);
      if (!stated) {
        throw new Error('docs/architecture.md no longer states a tool count in the form "Tool handlers (N tools)".');
      }
      if (Number(stated[1]) !== TOOL_DEFINITIONS.length) {
        throw new Error(
          `docs/architecture.md says ${stated[1]} tools; there are ${TOOL_DEFINITIONS.length}.`,
        );
      }

      console.log(`Tools reference is up to date: ${outputPath}`);
      return;
    }
    writeFileSync(outputPath, markdown, 'utf8');
    console.log(`Generated tools reference at: ${outputPath}`);
  } catch (err) {
    console.error('Failed to generate tool docs. Make sure you run `npm run build` first.', err);
    process.exit(1);
  }
}

main();
