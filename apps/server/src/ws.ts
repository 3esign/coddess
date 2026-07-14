import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, NormalizedEntry } from '@coddess/shared';
import { getProject } from './store.js';
import { startRun, type RunHandle, activeRuns } from './agent/loop.js';
import { startOrchestration } from './agent/orchestrator.js';
import { enqueueInjection } from './agent/injections.js';

interface Client {
  socket: WebSocket;
  projectId?: string;
  isAlive: boolean;
}

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<Client>();
  const runs = new Map<string, RunHandle>(); // runId -> handle

  // Heartbeat: ping every client periodically and drop the ones that stop
  // answering. Half-open sockets (laptop sleep, dropped Wi-Fi, a tab that was
  // killed) otherwise pile up forever, and a send() to one can throw.
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.isAlive) {
        try { c.socket.terminate(); } catch { /* ignore */ }
        clients.delete(c);
        continue;
      }
      c.isAlive = false;
      try { c.socket.ping(); } catch { clients.delete(c); }
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));

  function broadcast(e: NormalizedEntry): void {
    const payload = JSON.stringify(e);
    for (const c of clients) {
      if (c.projectId === e.projectId && c.socket.readyState === WebSocket.OPEN) {
        // A socket can flip to CLOSING between the readyState check and send();
        // guard so one dead client can never throw up into the run loop.
        try {
          c.socket.send(payload);
        } catch {
          clients.delete(c);
        }
      }
    }
    if (e.kind === 'status' && ['done', 'error', 'cancelled', 'paused'].includes(e.status)) {
      runs.delete(e.runId);
    }
  }

  wss.on('connection', (socket) => {
    const client: Client = { socket, isAlive: true };
    clients.add(client);
    socket.on('pong', () => { client.isAlive = true; });

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
        const handle = startOrchestration(project, msg.goal, msg.model, chatId, msg.maxTokens, msg.projectMaxTokens, broadcast);
        runs.set(handle.runId, handle);
        return;
      }

      if (msg.type === 'inject') {
        const chatId = msg.chatId || 'default';
        let foundHandle: RunHandle | null = null;
        for (const handle of runs.values()) {
          const activeInfo = activeRuns.get(handle.runId);
          if (activeInfo && activeInfo.projectId === msg.projectId && activeInfo.chatId === chatId) {
            foundHandle = handle;
            break;
          }
        }
        if (foundHandle && 'inject' in foundHandle) {
          (foundHandle as any).inject(msg.text);
        } else {
          enqueueInjection(msg.projectId, chatId, msg.text);
        }
        return;
      }

      if (msg.type === 'cancel') {
        let handle = runs.get(msg.runId);
        if (!handle) {
          const activeInfo = activeRuns.get(msg.runId);
          if (activeInfo) {
            for (const h of runs.values()) {
              const rootInfo = activeRuns.get(h.runId);
              if (rootInfo && rootInfo.projectId === activeInfo.projectId && rootInfo.chatId === activeInfo.chatId) {
                handle = h;
                break;
              }
            }
          }
        }
        handle?.cancel();
      }
      if (msg.type === 'pause') {
        let handle = runs.get(msg.runId);
        if (!handle) {
          const activeInfo = activeRuns.get(msg.runId);
          if (activeInfo) {
            for (const h of runs.values()) {
              const rootInfo = activeRuns.get(h.runId);
              if (rootInfo && rootInfo.projectId === activeInfo.projectId && rootInfo.chatId === activeInfo.chatId) {
                handle = h;
                break;
              }
            }
          }
        }
        handle?.pause();
      }
    });

    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });
}
