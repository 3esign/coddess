import fs from 'node:fs';
import path from 'node:path';
import type { ModelOverrides } from '@coddess/shared';
import { DATA_DIR, ensureDataDir } from './config.js';
import { encryptSecret, decryptSecret } from './crypto.js';

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

export interface Settings {
  apiKeys: {
    openrouter?: string;
    anthropic?: string;
    gemini?: string;
    kimi?: string;
    deepseek?: string;
  };
  customProviders: CustomProvider[];
  modelOverrides: ModelOverrides;
}

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const KEY_NAMES = ['openrouter', 'anthropic', 'gemini', 'kimi', 'deepseek'] as const;
const ENV_MAP: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  kimi: 'KIMI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

function emptyOverrides(): ModelOverrides {
  return { added: [], hidden: [] };
}

function readRaw(): Partial<Settings> {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<Settings>;
  } catch (err) {
    console.error('Failed to parse settings.json:', err);
    return {};
  }
}

function coerceOverrides(o: any): ModelOverrides {
  if (!o || typeof o !== 'object') return emptyOverrides();
  const added = Array.isArray(o.added)
    ? o.added
        .filter((m: any) => m && typeof m.id === 'string')
        .map((m: any) => ({ id: String(m.id), name: String(m.name || m.id), provider: String(m.provider || 'openrouter') }))
    : [];
  const hidden = Array.isArray(o.hidden) ? o.hidden.map((s: any) => String(s)) : [];
  return { added, hidden };
}

/** Settings with API keys decrypted. Env vars win over stored keys. */
export function getSettings(): Settings {
  const raw = readRaw();
  const apiKeys: Settings['apiKeys'] = {};
  for (const k of KEY_NAMES) {
    const stored = raw.apiKeys?.[k];
    apiKeys[k] = process.env[ENV_MAP[k]!] || (stored ? decryptSecret(stored) : '') || '';
  }
  const customProviders = (raw.customProviders || []).map((p) => ({
    ...p,
    apiKey: p.apiKey ? decryptSecret(p.apiKey) : '',
  }));
  return { apiKeys, customProviders, modelOverrides: coerceOverrides(raw.modelOverrides) };
}

/** Persist settings, encrypting every secret before it touches disk. */
export function saveSettings(settings: Settings): void {
  ensureDataDir();
  const encrypted: Settings = {
    apiKeys: {},
    customProviders: (settings.customProviders || []).map((p) => ({
      ...p,
      apiKey: p.apiKey ? encryptSecret(p.apiKey) : '',
    })),
    modelOverrides: coerceOverrides(settings.modelOverrides),
  };
  for (const k of KEY_NAMES) {
    const v = settings.apiKeys?.[k];
    encrypted.apiKeys[k] = v ? encryptSecret(v) : '';
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(encrypted, null, 2), 'utf8');
}
