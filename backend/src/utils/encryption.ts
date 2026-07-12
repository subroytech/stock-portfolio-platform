// AES-256-GCM encryption for user-owned API keys (users_subscriptions table).
// Node's built-in crypto module - no external dependency. Stores
// iv:authTag:ciphertext (hex, colon-delimited) as a single string.

import crypto from 'crypto';
import env from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12; // NIST-recommended IV length for GCM

function loadKey(): Buffer {
  const hex = env.apiKeyEncryptionKey;
  if (!hex) throw new Error('API_KEY_ENCRYPTION_KEY is not set in backend environment.');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`API_KEY_ENCRYPTION_KEY must be a ${KEY_LENGTH_BYTES}-byte (${KEY_LENGTH_BYTES * 2}-hex-char) value.`);
  }
  return key;
}

// Validated eagerly at module load - matches pool.ts's fail-fast pattern for
// DATABASE_URL, so a misconfigured key is caught at boot, not on first use.
const KEY = loadKey();

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

export function decrypt(encoded: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted value.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}
