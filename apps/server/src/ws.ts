import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, NormalizedEntry } from '@coddess/shared';
import { getProject } from './store.js';
import { startRun, type RunHandle } from './agent/loop.js';
import { startOrchestration } from './agent/orchestrator.js';
import { enqueueInjection } from './agent/injections.js';

interface Client {
  socket: WebSocket;
  projectId?: string;
}

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<Client>();
  const runs = new Map<string, RunHandle>(); // runId -> handle

  function broadcast(e: NormalizedEntry): void {
    const payload = JSON.stringify(e);
    for (const c of clients) {
      if (c.projectId === e.projectId && c.socket.readyState === WebSocket.OPEN) {
        c.socket.send(payload);
      }
    }
    if (e.kind === 'status' && ['done', 'error', 'cancelled', 'paused'].includes(e.status)) {
      runs.delete(e.runId);
    }
  }

  wss.on('connection', (socket) => {
    const client: Client = { socket };
    clients.add(client);

    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'subscribe') {
        client.projectId = msg.projectId;
        return;
      }

      if (msg.type === 'run') {
        const project = getProject(msg.projectId);
        if (!project) {
          socket.send(JSON.stringify({
            kind: 'error', runId: 'na', projectId: msg.projectId, ts: Date.now(),
            message: 'Project not found.',
          } satisfies NormalizedEntry));
          return;
        }
        client.projectId = msg.projectId;
        const chatId = msg.chatId || 'default';
        const handle = startRun(project, msg.prompt, msg.model, chatId, msg.maxTokens, msg.projectMaxTokens, broadcast);
        runs.set(handle.runId, handle);
        return;
      }

      if (msg.type === 'orchestrate') {
        const project = getProject(msg.projectId);
        if (!project) {
          socket.send(JSON.stringify({
            kind: 'error', runId: 'na', projectId: msg.projectId, ts: Date.now(),
            message: 'Project not found.',
          } satisfies NormalizedEntry));
          return;
        }
        client.projectId = msg.projectId;
        const chatId = msg.chatId || 'default';
        const handle = startOrchestration(project, msg.goal, msg.model, chatId, broadcast);
        runs.set(handle.runId, handle);
        return;
      }

      if (msg.type === 'inject') {
        enqueueInjection(msg.projectId, msg.chatId || 'default', msg.text);
        return;
      }

      if (msg.type === 'cancel') {
        const handle = runs.get(msg.runId);
        handle?.cancel();
      }
      if (msg.type === 'pause') {
        const handle = runs.get(msg.runId);
        handle?.pause();
      }
    });

    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });
}
