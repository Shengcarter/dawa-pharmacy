import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Field encryption for secrets stored in the database (2FA keys), using
 * Node's built-in AES-256-GCM. The key comes from DATA_ENCRYPTION_KEY
 * (32 random bytes, base64); development falls back to a key derived from
 * JWT_ACCESS_SECRET with HKDF so a fresh checkout still runs.
 */
const key: Buffer = env.DATA_ENCRYPTION_KEY
  ? Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64')
  : Buffer.from(hkdfSync('sha256', env.JWT_ACCESS_SECRET, 'dawa', 'data-encryption-v1', 32));

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
