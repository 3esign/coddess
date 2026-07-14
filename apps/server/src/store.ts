import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Project } from '@coddess/shared';
import { PROJECTS_FILE, ensureDataDir } from './config.js';

function load(): Project[] {
  ensureDataDir();
  if (!fs.existsSync(PROJECTS_FILE)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')) as Project[];
    return list.map((p) => ({ ...p, contextDirs: Array.isArray(p.contextDirs) ? p.contextDirs : [] }));
  } catch {
    return [];
  }
}

function save(projects: Project[]): void {
  ensureDataDir();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

function migrateProjectConfig(projectPath: string) {
  const oldPath = path.join(projectPath, '.oscode');
  const newPath = path.join(projectPath, '.coddess');
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    try {
      fs.renameSync(oldPath, newPath);
    } catch (err) {
      console.error(`Failed to migrate project config at ${projectPath}:`, err);
    }
  }
}

export function listProjects(): Project[] {
  const list = load();
  for (const p of list) migrateProjectConfig(p.path);
  return list;
}

export function getProject(id: string): Project | undefined {
  const p = load().find((p) => p.id === id);
  if (p) migrateProjectConfig(p.path);
  return p;
}

export interface AddProjectInput {
  path: string;
  name?: string;
  model?: string;
}

export function addProject(input: AddProjectInput): Project {
  const abs = path.resolve(input.path);
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
  else if (!fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
  const projects = load();
  const existing = projects.find((p) => path.resolve(p.path) === abs);
  if (existing) return existing;
  const project: Project = {
    id: nanoid(10),
    name: input.name?.trim() || path.basename(abs),
    path: abs,
    createdAt: Date.now(),
    model: input.model,
    contextDirs: [],
  };
  projects.push(project);
  save(projects);
  return project;
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'model'>>): Project {
  const projects = load();
  const p = projects.find((x) => x.id === id);
  if (!p) throw new Error('Project not found');
  if (patch.name !== undefined) p.name = patch.name;
  if (patch.model !== undefined) p.model = patch.model;
  save(projects);
  return p;
}

export function removeProject(id: string): void {
  save(load().filter((p) => p.id !== id));
}

/** Link an extra read-only folder as temporary context. */
export function addContextDir(id: string, dirPath: string): Project {
  const projects = load();
  const p = projects.find((x) => x.id === id);
  if (!p) throw new Error('Project not found');
  const abs = path.resolve(dirPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
  p.contextDirs = p.contextDirs || [];
  if (path.resolve(p.path) === abs) throw new Error('That is the project folder itself.');
  if (!p.contextDirs.some((d) => path.resolve(d) === abs)) p.contextDirs.push(abs);
  save(projects);
  return p;
}

export function removeContextDir(id: string, dirPath: string): Project {
  const projects = load();
  const p = projects.find((x) => x.id === id);
  if (!p) throw new Error('Project not found');
  const abs = path.resolve(dirPath);
  p.contextDirs = (p.contextDirs || []).filter((d) => path.resolve(d) !== abs);
  save(projects);
  return p;
}
