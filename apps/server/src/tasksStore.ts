import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Project } from '@coddess/shared';

/**
 * Kanban task store. Each task is a unit of work an agent can pick up; when it
 * runs in isolation it gets its own git worktree + branch (see git.ts). Tasks
 * are persisted per-project under .coddess/tasks.json.
 */

export type TaskStatus = 'queued' | 'running' | 'review' | 'done';

export interface TaskCard {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  label: string;
  model?: string;
  chatId?: string;
  branch?: string;
  worktreePath?: string;
  createdAt: number;
  updatedAt: number;
}

function tasksFile(project: Project): string {
  return path.join(project.path, '.coddess', 'tasks.json');
}

export function listTasks(project: Project): TaskCard[] {
  const file = tasksFile(project);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as TaskCard[];
  } catch (err) {
    console.error('Failed to read tasks:', err);
  }
  return [];
}

function saveTasks(project: Project, tasks: TaskCard[]): void {
  const file = tasksFile(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(tasks, null, 2), 'utf8');
}

export function createTask(
  project: Project,
  input: { title: string; prompt: string; label?: string; model?: string },
): TaskCard {
  const tasks = listTasks(project);
  const now = Date.now();
  const task: TaskCard = {
    id: nanoid(10),
    title: input.title.trim() || 'Untitled task',
    prompt: input.prompt,
    status: 'queued',
    label: input.label || 'Feature',
    model: input.model,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(task);
  saveTasks(project, tasks);
  return task;
}

export function updateTask(project: Project, id: string, patch: Partial<TaskCard>): TaskCard | undefined {
  const tasks = listTasks(project);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  tasks[idx] = { ...tasks[idx]!, ...patch, id, updatedAt: Date.now() };
  saveTasks(project, tasks);
  return tasks[idx];
}

export function deleteTask(project: Project, id: string): void {
  saveTasks(project, listTasks(project).filter((t) => t.id !== id));
}
