import fs from 'node:fs';
import path from 'node:path';
import type { NormalizedEntry, Project } from '@coddess/shared';
import type { ChatMessage } from './provider/providerRouter.js';

/**
 * All on-disk chat persistence for a project lives under <project>/.coddess/chats.
 * Extracted out of the agent loop so the loop only orchestrates and this module
 * owns the (previously duplicated, try/catch-heavy) file I/O.
 */

export interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  model?: string;
  totalTokens?: number;
  lastOutputTokens?: number;
  status?: string;
}

export interface ChatPaths {
  chatsDir: string;
  chatFile: string;
  historyFile: string;
  metadataFile: string;
}

export function chatPaths(project: Project, chatId: string): ChatPaths {
  const chatsDir = path.join(project.path, '.coddess', 'chats');
  return {
    chatsDir,
    chatFile: path.join(chatsDir, `${chatId}_messages.json`),
    historyFile: path.join(chatsDir, `${chatId}_history.json`),
    metadataFile: path.join(chatsDir, 'metadata.json'),
  };
}

export function ensureChatDir(p: ChatPaths): void {
  if (!fs.existsSync(p.chatsDir)) fs.mkdirSync(p.chatsDir, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    console.error(`Failed to read ${file}:`, err);
  }
  return fallback;
}

export function readMessages(p: ChatPaths): ChatMessage[] {
  return readJson<ChatMessage[]>(p.chatFile, []);
}

export function writeMessages(p: ChatPaths, messages: ChatMessage[]): void {
  try {
    fs.writeFileSync(p.chatFile, JSON.stringify(messages, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save chat messages:', err);
  }
}

export function appendHistory(p: ChatPaths, entry: NormalizedEntry | Record<string, unknown>): void {
  try {
    const history = readJson<unknown[]>(p.historyFile, []);
    history.push(entry);
    fs.writeFileSync(p.historyFile, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to append to history:', err);
  }
}

export function readMeta(p: ChatPaths): ChatMeta[] {
  return readJson<ChatMeta[]>(p.metadataFile, []);
}

export function writeMeta(p: ChatPaths, meta: ChatMeta[]): void {
  try {
    fs.writeFileSync(p.metadataFile, JSON.stringify(meta, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write chat metadata:', err);
  }
}

/** Update (or insert) one chat's metadata row. */
export function updateChatMeta(
  p: ChatPaths,
  chatId: string,
  fields: Partial<ChatMeta> & { fallbackTitle?: string },
): void {
  const meta = readMeta(p);
  const idx = meta.findIndex((c) => c.id === chatId);
  const { fallbackTitle, ...rest } = fields;
  const base: ChatMeta =
    idx !== -1
      ? meta[idx]!
      : { id: chatId, title: fallbackTitle || 'Chat', createdAt: Date.now() };
  const merged = { ...base, ...rest };
  if (idx !== -1) meta[idx] = merged;
  else meta.push(merged);
  writeMeta(p, merged.title ? meta : meta);
}

export function isPausedContinuation(p: ChatPaths, chatId: string): boolean {
  const meta = readMeta(p);
  return meta.find((c) => c.id === chatId)?.status === 'paused';
}

/** Total tokens attributed to every OTHER chat in the project (for project budgets). */
export function otherChatsTokens(p: ChatPaths, chatId: string): number {
  return readMeta(p)
    .filter((c) => c.id !== chatId)
    .reduce((sum, c) => sum + (c.totalTokens || 0), 0);
}
