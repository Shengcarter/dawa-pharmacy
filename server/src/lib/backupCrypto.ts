import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Encrypted backup format (Node's built-in AES-256-GCM, no custom crypto):
 *   "DAWAENC1" (8 bytes) | IV (12 bytes) | ciphertext | auth tag (16 bytes)
 * The tag authenticates the whole file: a modified or truncated backup fails to decrypt.
 */
const MAGIC = Buffer.from('DAWAENC1');
const IV_LEN = 12;
const TAG_LEN = 16;

export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('The backup key must be 32 bytes, base64-encoded.');
  return key;
}

/** A transform that turns a plain stream into the encrypted format. */
export function encryptingStream(key: Buffer): Transform {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let started = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (!started) { started = true; this.push(Buffer.concat([MAGIC, iv])); }
      cb(null, cipher.update(chunk));
    },
    flush(cb) {
      if (!started) this.push(Buffer.concat([MAGIC, iv]));
      this.push(cipher.final());
      this.push(cipher.getAuthTag());
      cb();
    },
  });
}

export async function isEncrypted(file: string) {
  const fh = await open(file, 'r');
  const head = Buffer.alloc(MAGIC.length);
  await fh.read(head, 0, MAGIC.length, 0);
  await fh.close();
  return head.equals(MAGIC);
}

/** Decrypts an encrypted backup to a plain pg_dump file; throws if the key is wrong or the file was altered. */
export async function decryptFile(input: string, output: string, key: Buffer) {
  const { size } = await stat(input);
  if (size < MAGIC.length + IV_LEN + TAG_LEN) throw new Error('File is too short to be an encrypted backup.');
  const fh = await open(input, 'r');
  const header = Buffer.alloc(MAGIC.length + IV_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  await fh.read(header, 0, header.length, 0);
  await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  await fh.close();
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted Dawa backup.');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(input, { start: header.length, end: size - TAG_LEN - 1 }), decipher, createWriteStream(output, { mode: 0o600 }));
}
