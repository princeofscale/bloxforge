import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveProjectPath, resolveProjectRoot } from './source-mapper.js';
import type { RojoProject } from './types.js';

function parseJsonc(raw: string): unknown {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    const next = raw[i + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      output += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < raw.length - 1 && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i++;
    } else {
      output += char;
    }
  }

  let normalized = '';
  inString = false;
  escaped = false;
  for (let i = 0; i < output.length; i++) {
    const char = output[i];
    if (inString) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      normalized += char;
      continue;
    }
    if (char === ',') {
      let next = i + 1;
      while (/\s/.test(output[next] ?? '')) next++;
      if (output[next] === '}' || output[next] === ']') continue;
    }
    normalized += char;
  }
  return JSON.parse(normalized);
}

function readProject(projectFile: string): RojoProject {
  const parsed = parseJsonc(fs.readFileSync(projectFile, 'utf8')) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || !parsed.tree || typeof parsed.tree !== 'object') {
    throw new Error(`Invalid Rojo project ${projectFile}: expected string "name" and object "tree"`);
  }
  return {
    name: parsed.name,
    root: path.dirname(projectFile),
    projectFile,
    servePort: typeof parsed.servePort === 'number' ? parsed.servePort : undefined,
    serveAddress: typeof parsed.serveAddress === 'string' ? parsed.serveAddress : undefined,
    servePlaceIds: Array.isArray(parsed.servePlaceIds)
      ? parsed.servePlaceIds.filter((value): value is number => Number.isInteger(value))
      : undefined,
    emitLegacyScripts: typeof parsed.emitLegacyScripts === 'boolean' ? parsed.emitLegacyScripts : undefined,
    globIgnorePaths: Array.isArray(parsed.globIgnorePaths)
      ? parsed.globIgnorePaths.filter((value): value is string => typeof value === 'string')
      : undefined,
    tree: parsed.tree as Record<string, unknown>,
  };
}

export function discoverRojoProjects(root = process.cwd()): RojoProject[] {
  const canonicalRoot = resolveProjectRoot(root);
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.bloxforge') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.project.json')) found.push(absolute);
    }
  };
  walk(canonicalRoot);
  return found.sort().map(readProject);
}

export function selectRojoProject(root = process.cwd(), projectFile?: string): RojoProject {
  if (projectFile) {
    const selected = resolveProjectPath(root, projectFile);
    if (!selected.endsWith('.project.json')) throw new Error('Rojo project file must end with .project.json');
    return readProject(selected);
  }
  const projects = discoverRojoProjects(root);
  if (projects.length === 0) throw new Error(`No Rojo project files found under ${resolveProjectRoot(root)}`);
  if (projects.length > 1) {
    throw new Error(`Multiple Rojo project files found; select one explicitly: ${projects.map((project) => path.relative(root, project.projectFile)).join(', ')}`);
  }
  return projects[0];
}
