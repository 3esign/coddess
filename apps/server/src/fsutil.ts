import fs from 'node:fs';
import path from 'node:path';
import type { FileNode } from '@coddess/shared';

const IGNORE = new Set(['node_modules', '.git', 'dist', '.data', '.next', '.cache', 'build']);

/**
 * Resolve a project-relative path to an absolute one, refusing anything that
 * escapes the project root. Every tool goes through this — it is the sandbox.
 */
export function resolveInProject(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`Path escapes project root: ${rel}`);
  }
  return abs;
}

export function buildTree(root: string, rel = '', depth = 0): FileNode[] {
  if (depth > 6) return [];
  const abs = path.resolve(root, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: FileNode[] = [];
  for (const e of entries.sort((a, b) => {
    // dirs first, then alphabetical
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  })) {
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    if (IGNORE.has(e.name)) continue;
    const childRel = path.join(rel, e.name);
    if (e.isDirectory()) {
      nodes.push({
        name: e.name,
        path: childRel,
        type: 'dir',
        children: buildTree(root, childRel, depth + 1),
      });
    } else {
      nodes.push({ name: e.name, path: childRel, type: 'file' });
    }
  }
  return nodes;
}

export function readFileSafe(root: string, rel: string): string {
  const abs = resolveInProject(root, rel);
  return fs.readFileSync(abs, 'utf8');
}
