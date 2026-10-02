import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env';
import { badRequest } from './errors';

/**
 * File storage. Public files (product images, logo) are served statically;
 * private files (expense receipts) are only streamed to authorised users.
 * Swap this module for object storage (S3, R2…) without touching callers.
 */
export const STORAGE_ROOT = path.resolve(env.STORAGE_DIR);
export const PUBLIC_DIR = path.join(STORAGE_ROOT, 'public');
export const PRIVATE_DIR = path.join(STORAGE_ROOT, 'private');
export const BACKUP_DIR = path.join(STORAGE_ROOT, 'backups');

for (const dir of [PUBLIC_DIR, PRIVATE_DIR, BACKUP_DIR]) mkdirSync(dir, { recursive: true });

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const RECEIPT_TYPES: Record<string, string> = { ...IMAGE_TYPES, 'application/pdf': '.pdf' };

function uploader(root: string, folder: string, types: Record<string, string>, maxMb: number) {
  const dir = path.join(root, folder);
  mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomBytes(8).toString('hex')}${types[file.mimetype]}`),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (types[file.mimetype]) cb(null, true);
      else cb(badRequest(`Unsupported file type. Allowed: ${Object.values(types).join(', ')}`));
    },
  }).single('file');
}

export const productImageUpload = uploader(PUBLIC_DIR, 'products', IMAGE_TYPES, 3);
export const logoUpload = uploader(PUBLIC_DIR, 'branding', IMAGE_TYPES, 2);
export const receiptUpload = uploader(PRIVATE_DIR, 'receipts', RECEIPT_TYPES, 8);

/** Path stored in the database for a public file, e.g. "products/123-ab.jpg". */
export const relativePublicPath = (folder: string, filename: string) => `${folder}/${filename}`;

/** Resolves a stored relative path inside a root, refusing traversal. */
export function safeResolve(root: string, relative: string): string {
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep)) throw badRequest('Invalid file path.');
  return full;
}

export async function removeStoredFile(root: string, relative: string | null | undefined) {
  if (!relative) return;
  await unlink(safeResolve(root, relative)).catch(() => undefined);
}
