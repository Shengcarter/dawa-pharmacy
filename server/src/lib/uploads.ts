import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { AppError, badRequest } from './errors';
import { scanFile } from './clamav';
import { logger } from './logger';

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

/** File signatures: the content must match the declared type, whatever the browser claims. */
const SIGNATURES: Record<string, (head: Buffer) => boolean> = {
  'image/jpeg': (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  'image/png': (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (h) => h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (h) => h.subarray(0, 5).toString('latin1') === '%PDF-',
};
/** PDF features that run code or carry other files; expense receipts never need them. */
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/;

if (!env.CLAMAV_HOST && env.isProduction) {
  logger.warn('CLAMAV_HOST is not set: uploaded files are type-checked but not scanned for malware');
}

/** After multer has stored the file: verify its content and (if configured) scan it; delete it on any failure. */
function verifyUpload(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const file = req.file;
    if (!file) return next();
    const reject = async (err: AppError) => { await unlink(file.path).catch(() => undefined); next(err); };
    try {
      const fh = await open(file.path, 'r');
      const head = Buffer.alloc(16);
      await fh.read(head, 0, 16, 0);
      const content = file.mimetype === 'application/pdf' ? (await fh.readFile()).toString('latin1') : null;
      await fh.close();
      if (!SIGNATURES[file.mimetype]?.(head)) return reject(badRequest('The file content does not match its type. Upload a real JPG, PNG, WebP or PDF file.'));
      if (content !== null && PDF_ACTIVE.test(content)) {
        return reject(badRequest('This PDF contains scripts, actions or attachments and cannot be uploaded. Print or save it as a plain PDF or a photo.'));
      }
      if (env.CLAMAV_HOST) {
        let result;
        try {
          result = await scanFile(file.path);
        } catch (err) {
          logger.error({ err }, 'Malware scan failed');
          return reject(new AppError(503, 'SCAN_UNAVAILABLE', 'The file could not be checked for viruses right now. Try again in a few minutes.'));
        }
        if (!result.clean) {
          logger.warn({ signature: result.signature, userId: req.actor?.userId, name: file.originalname }, 'Infected upload refused');
          return reject(new AppError(422, 'INFECTED', 'This file was flagged as malware and was not saved.'));
        }
      }
      next();
    } catch (err) {
      await unlink(file.path).catch(() => undefined);
      next(err);
    }
  };
}

function uploader(root: string, folder: string, types: Record<string, string>, maxMb: number): RequestHandler[] {
  const dir = path.join(root, folder);
  mkdirSync(dir, { recursive: true });
  const upload = multer({
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
  return [upload, verifyUpload()];
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
