import crypto from 'crypto';
import { getEnv } from './env.js';

/**
 * AES-256-GCM field-level encryption for storing sensitive secrets at rest
 * (e.g. TOTP shared secrets). Key is derived from JWT_SECRET via HKDF-like
 * SHA-256 so rotating the JWT secret invalidates the stored ciphertexts —
 * which is the desired behaviour (forcing 2FA re-enrolment on key rotation).
 */
function getKey(): Buffer {
  const env = getEnv();
  return crypto.createHash('sha256').update(env.JWT_SECRET + ':fieldcrypt:v1').digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed encrypted value');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
