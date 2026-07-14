import type { Project, FileNode, GitStatus, TaskCard } from '@coddess/shared';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
}

export interface Health {
  ok: boolean;
  ollamaHost: string;
  ollamaReachable: boolean;
  defaultModel: string;
  allowShell: boolean;
  models: ModelEntry[];
}

export const api = {
  health: () => fetch('/api/health').then(j<Health>),
  listProjects: () => fetch('/api/projects').then(j<{ projects: Project[] }>).then((r) => r.projects),
  addProject: (path: string, name?: string, model?: string) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name, model }),
    }).then(j<{ project: Project }>).then((r) => r.project),
  updateProject: (id: string, patch: { name?: string; model?: string }) =>
    fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(j<{ project: Project }>).then((r) => r.project),
  removeProject: (id: string) => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(j),
  tree: (id: string) => fetch(`/api/projects/${id}/tree`).then(j<{ tree: FileNode[] }>).then((r) => r.tree),
  file: (id: string, path: string) =>
    fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`).then(j<{ path: string; content: string }>),
  listDir: (path?: string) =>
    fetch(`/api/system/fs/list?path=${encodeURIComponent(path || '')}`)
      .then(j<{ currentPath: string; parentPath: string | null; directories: string[]; drives: string[] }>),
  makeDir: (parentPath: string, name: string) =>
    fetch('/api/system/fs/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: parentPath, name }),
    }).then(j<{ ok: boolean; path: string }>).then((r) => r.path),
  history: (id: string) => fetch(`/api/projects/${id}/history`).then(j<{ events: import('@coddess/shared').NormalizedEntry[] }>).then((r) => r.events),
  clearHistory: (id: string) => fetch(`/api/projects/${id}/history`, { method: 'DELETE' }).then(j),
  getSettings: () => fetch('/api/settings').then(j<any>),
  saveSettings: (settings: any) =>
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).then(j<{ ok: boolean }>),
  listChats: (id: string) => fetch(`/api/projects/${id}/chats`).then(j<{ chats: any[] }>).then((r) => r.chats),
  createChat: (id: string, title?: string, model?: string) =>
    fetch(`/api/projects/${id}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, model }),
    }).then(j<{ chat: any }>).then((r) => r.chat),
  renameChat: (id: string, chatId: string, title: string) =>
    fetch(`/api/projects/${id}/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).then(j<{ chat: any }>).then((r) => r.chat),
  deleteChat: (id: string, chatId: string) => fetch(`/api/projects/${id}/chats/${chatId}`, { method: 'DELETE' }).then(j),
  chatHistory: (id: string, chatId: string) => fetch(`/api/projects/${id}/chats/${chatId}/history`).then(j<{ events: import('@coddess/shared').NormalizedEntry[] }>).then((r) => r.events),
  openFileNatively: (id: string, path: string) =>
    fetch(`/api/projects/${id}/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then(j<{ ok: boolean }>),

  addContext: (id: string, path: string) =>
    fetch(`/api/projects/${id}/context`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
      .then(j<{ project: Project }>).then((r) => r.project),
  removeContext: (id: string, path: string) =>
    fetch(`/api/projects/${id}/context`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
      .then(j<{ project: Project }>).then((r) => r.project),

  // git / review
  gitStatus: (id: string) => fetch(`/api/projects/${id}/git/status`).then(j<GitStatus>),
  gitDiff: (id: string) => fetch(`/api/projects/${id}/git/diff`).then(j<{ diff: string }>).then((r) => r.diff),
  gitCommit: (id: string, message: string) =>
    fetch(`/api/projects/${id}/git/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }).then(j<{ ok: boolean; output: string }>),
  gitDiscard: (id: string) => fetch(`/api/projects/${id}/git/discard`, { method: 'POST' }).then(j<{ ok: boolean }>),
  gitInit: (id: string) => fetch(`/api/projects/${id}/git/init`, { method: 'POST' }).then(j<{ ok: boolean }>),

  // tasks (kanban)
  listTasks: (id: string) => fetch(`/api/projects/${id}/tasks`).then(j<{ tasks: TaskCard[] }>).then((r) => r.tasks),
  createTask: (id: string, input: { title: string; prompt: string; label?: string; model?: string }) =>
    fetch(`/api/projects/${id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(j<{ task: TaskCard }>).then((r) => r.task),
  updateTask: (id: string, taskId: string, patch: Partial<TaskCard>) =>
    fetch(`/api/projects/${id}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(j<{ task: TaskCard }>).then((r) => r.task),
  deleteTask: (id: string, taskId: string) =>
    fetch(`/api/projects/${id}/tasks/${taskId}`, { method: 'DELETE' }).then(j<{ ok: boolean }>),
};
