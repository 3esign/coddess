import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DATA_DIR, ensureDataDir } from './config.js';

/**
 * Local secret-at-rest encryption for API keys.
 *
 * The plan called for OS-keychain storage with an AES fallback. Keychain access
 * needs a native dependency (keytar), so v1 ships the AES-256-GCM fallback:
 * a random 32-byte master key is generated once and stored in a 0600 file next
 * to the app data. It is bound to the machine via an HKDF over the master key +
 * a host identifier. This is not a substitute for a hardware keystore, but it
 * keeps keys out of plaintext on disk — a meaningful improvement over storing
 * them as-is in settings.json.
 */

const KEY_FILE = path.join(DATA_DIR, '.masterkey');
const ENC_PREFIX = 'enc:v1:';

function loadOrCreateMasterKey(): Buffer {
  ensureDataDir();
  if (fs.existsSync(KEY_FILE)) {
    try {
      const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === 32) return buf;
    } catch {
      /* fall through and regenerate */
    }
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('base64'), { mode: 0o600 });
  try {
    fs.chmodSync(KEY_FILE, 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
  return key;
}

function derivedKey(): Buffer {
  const master = loadOrCreateMasterKey();
  const hostSalt = crypto.createHash('sha256').update(os.hostname() + os.userInfo().username).digest();
  return crypto.hkdfSync('sha256', master, hostSalt, Buffer.from('coddess-apikeys'), 32) as unknown as Buffer;
}

export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/** Encrypt a plaintext string. Empty strings pass through unchanged. */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (isEncrypted(plain)) return plain; // already encrypted
  const key = derivedKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Decrypt a value produced by encryptSecret. Non-encrypted values pass through. */
export function decryptSecret(value: string): string {
  if (!value || !isEncrypted(value)) return value || '';
  try {
    const raw = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const key = derivedKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
