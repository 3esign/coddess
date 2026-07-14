import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PORT, OLLAMA_HOST, DEFAULT_MODEL, ALLOW_SHELL } from './config.js';
import { listProjects, getProject, addProject, updateProject, removeProject, addContextDir, removeContextDir } from './store.js';
import { buildTree, readFileSafe } from './fsutil.js';
import { listModels } from './agent/provider/ollama.js';
import { attachWebSocket } from './ws.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { nanoid } from 'nanoid';
import { getSettings, saveSettings } from './settings.js';
import * as git from './git.js';
import { listTasks, createTask, updateTask, deleteTask } from './tasksStore.js';

/**
 * Crash guards. This one process serves BOTH the REST API (projects, chats,
 * settings) and the WebSocket run stream. Without these handlers, a single
 * unhandled promise rejection or thrown error anywhere in the async agent
 * pipeline (a provider stream error, a fire-and-forget critique/knowledge call,
 * a socket that closes mid-send, a Puppeteer launch failure, ...) terminates
 * the entire Node process — Node's default for an unhandled rejection. That
 * took the whole app down at once: the UI shows "connecting…", the project list
 * comes back empty, "New Chat" does nothing, and queued messages are dropped.
 * `tsx watch` only restarts on FILE CHANGES, not on crashes, so the outage was
 * permanent until a manual restart. Log and keep serving instead of dying.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[coddess] Unhandled promise rejection (kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[coddess] Uncaught exception (kept alive):', err);
});

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get('/api/health', async () => {
  const settings = getSettings();
  const ollamaModels = await listModels();
  const modelsList = await aggregateModels(ollamaModels);
  return {
    ok: true,
    ollamaHost: OLLAMA_HOST,
    ollamaReachable: ollamaModels.length > 0,
    defaultModel: DEFAULT_MODEL,
    allowShell: ALLOW_SHELL,
    models: modelsList,
  };
});

app.get('/api/models', async () => {
  const ollamaModels = await listModels();
  const modelsList = await aggregateModels(ollamaModels);
  return { models: modelsList };
});

app.get('/api/settings', async () => {
  return getSettings();
});

app.post('/api/settings', async (req, reply) => {
  const body = req.body as any;
  if (!body) return reply.code(400).send({ error: 'Body is required' });
  try {
    saveSettings(body);
    return { ok: true };
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

async function aggregateModels(ollamaModels: string[]) {
  const settings = getSettings();
  const list: { id: string; name: string; provider: string }[] = [];

  for (const m of ollamaModels) {
    list.push({ id: m, name: m, provider: 'ollama' });
  }

  if (settings.apiKeys.openrouter) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${settings.apiKeys.openrouter}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as { data?: { id: string; name: string }[] };
        const openRouterModels = (data.data ?? []).map(m => ({
          id: `openrouter/${m.id}`,
          name: m.name || m.id,
          provider: 'openrouter',
        }));
        list.push(...openRouterModels);
      } else {
        throw new Error(`OpenRouter returned status ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch OpenRouter models:', err);
      list.push(
        { id: 'openrouter/anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (OpenRouter)', provider: 'openrouter' },
        { id: 'openrouter/google/gemini-2.5-pro', name: 'Gemini 2.5 Pro (OpenRouter)', provider: 'openrouter' },
        { id: 'openrouter/deepseek/deepseek-chat', name: 'DeepSeek V3 (OpenRouter)', provider: 'openrouter' },
        { id: 'openrouter/meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (OpenRouter)', provider: 'openrouter' },
      );
    }
  } else {
    list.push(
      { id: 'openrouter/anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (OpenRouter)', provider: 'openrouter' },
      { id: 'openrouter/google/gemini-2.5-pro', name: 'Gemini 2.5 Pro (OpenRouter)', provider: 'openrouter' },
      { id: 'openrouter/deepseek/deepseek-chat', name: 'DeepSeek V3 (OpenRouter)', provider: 'openrouter' },
      { id: 'openrouter/meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (OpenRouter)', provider: 'openrouter' },
    );
  }

  list.push(
    { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
    { id: 'anthropic/claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic' },
    { id: 'anthropic/claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic' },
  );

  list.push(
    { id: 'gemini/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini' },
    { id: 'gemini/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini' },
    { id: 'gemini/gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'gemini' },
    { id: 'gemini/gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini' },
  );

  list.push(
    { id: 'kimi/moonshot-v1-8k', name: 'Moonshot v1 8K', provider: 'kimi' },
    { id: 'kimi/moonshot-v1-32k', name: 'Moonshot v1 32K', provider: 'kimi' },
    { id: 'kimi/moonshot-v1-128k', name: 'Moonshot v1 128K', provider: 'kimi' },
  );

  list.push(
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat (V3)', provider: 'deepseek' },
    { id: 'deepseek/deepseek-coder', name: 'DeepSeek Coder', provider: 'deepseek' },
  );

  for (const prov of settings.customProviders) {
    for (const m of prov.models) {
      list.push({ id: `custom/${prov.id}/${m}`, name: `${m} (${prov.name})`, provider: `custom-${prov.id}` });
    }
  }

  // Apply user overrides: add custom models, then hide any the user removed.
  const overrides = settings.modelOverrides || { added: [], hidden: [] };
  for (const m of overrides.added) {
    if (m.id && !list.some((x) => x.id === m.id)) {
      list.push({ id: m.id, name: m.name || m.id, provider: m.provider || 'openrouter' });
    }
  }
  const hidden = new Set(overrides.hidden || []);
  return list.filter((m) => !hidden.has(m.id));
}

app.get('/api/projects', async () => ({ projects: listProjects() }));

app.post('/api/projects', async (req, reply) => {
  const body = req.body as { path?: string; name?: string; model?: string };
  if (!body?.path) return reply.code(400).send({ error: 'path is required' });
  try {
    return { project: addProject({ path: body.path, name: body.name, model: body.model }) };
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

app.patch('/api/projects/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { name?: string; model?: string };
  try {
    return { project: updateProject(id, body) };
  } catch (err) {
    return reply.code(404).send({ error: (err as Error).message });
  }
});

app.delete('/api/projects/:id', async (req) => {
  const { id } = req.params as { id: string };
  removeProject(id);
  return { ok: true };
});

app.get('/api/projects/:id/tree', async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  return { tree: buildTree(p.path) };
});

app.get('/api/projects/:id/history', async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const historyFile = path.join(p.path, '.coddess', 'chats', 'default_history.json');
  if (!fs.existsSync(historyFile)) return { events: [] };
  try {
    const events = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    return { events };
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.delete('/api/projects/:id/history', async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const chatsDir = path.join(p.path, '.coddess', 'chats');
  const historyFile = path.join(chatsDir, 'default_history.json');
  const chatFile = path.join(chatsDir, 'default_messages.json');
  try {
    if (fs.existsSync(historyFile)) fs.unlinkSync(historyFile);
    if (fs.existsSync(chatFile)) fs.unlinkSync(chatFile);
    return { ok: true };
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.get('/api/projects/:id/chats', async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const metadataFile = path.join(p.path, '.coddess', 'chats', 'metadata.json');
  if (!fs.existsSync(metadataFile)) return { chats: [] };
  try {
    const chats = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    return { chats };
  } catch (err) {
    return { chats: [] };
  }
});

app.post('/api/projects/:id/chats', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { title?: string; model?: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const chatsDir = path.join(p.path, '.coddess', 'chats');
  if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });
  const chatId = nanoid(10);
  const metadataFile = path.join(chatsDir, 'metadata.json');
  let meta: any[] = [];
  if (fs.existsSync(metadataFile)) {
    try { meta = JSON.parse(fs.readFileSync(metadataFile, 'utf8')); } catch {}
  }
  const newChat = {
    id: chatId,
    title: body.title?.trim() || 'New Chat',
    createdAt: Date.now(),
    model: body.model || '',
    totalTokens: 0,
    lastOutputTokens: 0,
    status: 'idle',
  };
  meta.push(newChat);
  fs.writeFileSync(metadataFile, JSON.stringify(meta, null, 2), 'utf8');
  fs.writeFileSync(path.join(chatsDir, `${chatId}_messages.json`), '[]', 'utf8');
  fs.writeFileSync(path.join(chatsDir, `${chatId}_history.json`), '[]', 'utf8');
  return { chat: newChat };
});

app.patch('/api/projects/:id/chats/:chatId', async (req, reply) => {
  const { id, chatId } = req.params as { id: string; chatId: string };
  const body = req.body as { title?: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const title = body?.title?.trim();
  if (!title) return reply.code(400).send({ error: 'title is required' });
  const metadataFile = path.join(p.path, '.coddess', 'chats', 'metadata.json');
  if (!fs.existsSync(metadataFile)) return reply.code(404).send({ error: 'Chat not found' });
  try {
    const meta: any[] = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    const idx = meta.findIndex((c) => c.id === chatId);
    if (idx === -1) return reply.code(404).send({ error: 'Chat not found' });
    meta[idx] = { ...meta[idx], title };
    fs.writeFileSync(metadataFile, JSON.stringify(meta, null, 2), 'utf8');
    return { chat: meta[idx] };
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.delete('/api/projects/:id/chats/:chatId', async (req, reply) => {
  const { id, chatId } = req.params as { id: string; chatId: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const chatsDir = path.join(p.path, '.coddess', 'chats');
  const metadataFile = path.join(chatsDir, 'metadata.json');
  const chatFile = path.join(chatsDir, `${chatId}_messages.json`);
  const historyFile = path.join(chatsDir, `${chatId}_history.json`);
  try {
    if (fs.existsSync(chatFile)) fs.unlinkSync(chatFile);
    if (fs.existsSync(historyFile)) fs.unlinkSync(historyFile);
    if (fs.existsSync(metadataFile)) {
      let meta: any[] = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      meta = meta.filter((c) => c.id !== chatId);
      fs.writeFileSync(metadataFile, JSON.stringify(meta, null, 2), 'utf8');
    }
    return { ok: true };
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.get('/api/projects/:id/chats/:chatId/history', async (req, reply) => {
  const { id, chatId } = req.params as { id: string; chatId: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const historyFile = path.join(p.path, '.coddess', 'chats', `${chatId}_history.json`);
  if (!fs.existsSync(historyFile)) return { events: [] };
  try {
    const events = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    return { events };
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.get('/api/projects/:id/file', async (req, reply) => {
  const { id } = req.params as { id: string };
  const { path: rel } = req.query as { path?: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  if (!rel) return reply.code(400).send({ error: 'path query is required' });
  try {
    return { path: rel, content: readFileSafe(p.path, rel) };
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

import { exec } from 'node:child_process';

function openFileNative(absolutePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd = '';
    if (platform === 'win32') {
      const winPath = absolutePath.replace(/\//g, '\\');
      cmd = `cmd /c start chrome "${winPath}" || cmd /c start "" "${winPath}"`;
    } else if (platform === 'darwin') {
      cmd = `open -a "Google Chrome" "${absolutePath}" || open "${absolutePath}"`;
    } else {
      cmd = `google-chrome "${absolutePath}" || xdg-open "${absolutePath}"`;
    }
    exec(cmd, (err) => {
      if (err) { console.error('Failed to open file natively:', err); reject(err); }
      else resolve();
    });
  });
}

app.post('/api/projects/:id/open-file', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { path?: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  if (!body?.path) return reply.code(400).send({ error: 'path is required' });
  const absPath = path.resolve(p.path, body.path);
  if (!fs.existsSync(absPath)) return reply.code(404).send({ error: 'File not found' });
  const url = `http://localhost:${PORT}/api/projects/${id}/serve/${body.path.replace(/\\/g, '/')}`;
  try {
    await openFileNative(url);
    return { ok: true };
  } catch (err) {
    return reply.code(500).send({ error: `Failed to open file: ${(err as Error).message}` });
  }
});

app.get('/api/projects/:id/serve/*', async (req, reply) => {
  const { id } = req.params as { id: string };
  const star = (req.params as any)['*'] || '';
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const absPath = path.resolve(p.path, star);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return reply.code(404).send('File not found');
  }
  const ext = path.extname(absPath).toLowerCase();
  let contentType = 'application/octet-stream';
  if (ext === '.html') contentType = 'text/html';
  else if (ext === '.js') contentType = 'application/javascript';
  else if (ext === '.css') contentType = 'text/css';
  else if (ext === '.json') contentType = 'application/json';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
  else if (ext === '.svg') contentType = 'image/svg+xml';
  reply.header('Content-Type', contentType);
  return fs.createReadStream(absPath);
});

app.get('/api/system/fs/list', async (req, reply) => {
  const query = req.query as { path?: string };
  const targetPath = query.path ? path.resolve(query.path) : os.homedir();
  try {
    if (!fs.existsSync(targetPath)) return reply.code(400).send({ error: `Path does not exist: ${targetPath}` });
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) return reply.code(400).send({ error: `Path is not a directory: ${targetPath}` });
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    const directories = entries
      .filter((e) => { try { return e.isDirectory(); } catch { return false; } })
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    const parentPath = path.dirname(targetPath) === targetPath ? null : path.dirname(targetPath);
    const drives: string[] = [];
    if (process.platform === 'win32') {
      for (let i = 65; i <= 90; i++) {
        const drive = String.fromCharCode(i) + ':\\';
        try { if (fs.existsSync(drive)) drives.push(drive); } catch {}
      }
    }
    return { currentPath: targetPath, parentPath, directories, drives };
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.post('/api/system/fs/mkdir', async (req, reply) => {
  const body = req.body as { path?: string; name?: string };
  if (!body?.path || !body?.name) return reply.code(400).send({ error: 'path and name are required' });
  const target = path.join(path.resolve(body.path), body.name.trim());
  try {
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    return { ok: true, path: target };
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

/* ------------------------------- git / review ------------------------------- */

app.get('/api/projects/:id/git/status', async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  return git.status(p.path);
});

app.get('/api/projects/:id/git/diff', async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  return { diff: await git.diff(p.path) };
});

app.post('/api/projects/:id/git/commit', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { message?: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const r = await git.commitAll(p.path, body?.message || 'Coddess changes');
  if (!r.ok) return reply.code(400).send({ error: r.output });
  return { ok: true, output: r.output };
});

app.post('/api/projects/:id/git/discard', async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const r = await git.discardAll(p.path);
  if (!r.ok) return reply.code(400).send({ error: r.output });
  return { ok: true, output: r.output };
});

app.post('/api/projects/:id/git/init', async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const ok = await git.ensureRepo(p.path);
  return { ok };
});

/* --------------------------------- tasks ----------------------------------- */

app.get('/api/projects/:id/tasks', async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  return { tasks: listTasks(p) };
});

app.post('/api/projects/:id/tasks', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { title?: string; prompt?: string; label?: string; model?: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  if (!body?.title && !body?.prompt) return reply.code(400).send({ error: 'title or prompt is required' });
  const task = createTask(p, {
    title: body.title || (body.prompt || '').slice(0, 40),
    prompt: body.prompt || '',
    label: body.label,
    model: body.model,
  });
  return { task };
});

app.patch('/api/projects/:id/tasks/:taskId', async (req, reply) => {
  const { id, taskId } = req.params as { id: string; taskId: string };
  const body = req.body as Record<string, unknown>;
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  const task = updateTask(p, taskId, body);
  if (!task) return reply.code(404).send({ error: 'Task not found' });
  return { task };
});

app.delete('/api/projects/:id/tasks/:taskId', async (req, reply) => {
  const { id, taskId } = req.params as { id: string; taskId: string };
  const p = getProject(id);
  if (!p) return reply.code(404).send({ error: 'Project not found' });
  deleteTask(p, taskId);
  return { ok: true };
});

app.post('/api/projects/:id/context', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { path?: string };
  if (!body?.path) return reply.code(400).send({ error: 'path is required' });
  try {
    return { project: addContextDir(id, body.path) };
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

app.delete('/api/projects/:id/context', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { path?: string };
  if (!body?.path) return reply.code(400).send({ error: 'path is required' });
  try {
    return { project: removeContextDir(id, body.path) };
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

const server = app.server;
attachWebSocket(server);

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`\n  Coddess server → http://127.0.0.1:${PORT}`);
console.log(`  Ollama        → ${OLLAMA_HOST}  (default model: ${DEFAULT_MODEL})`);
console.log(`  Shell tool    → ${ALLOW_SHELL ? 'enabled' : 'disabled'}\n`);
