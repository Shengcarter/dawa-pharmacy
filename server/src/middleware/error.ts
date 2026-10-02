import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

/** Friendly messages for constraint violations that slip past service checks. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  products_sku_key: 'Another product already uses this SKU.',
  products_barcode_key: 'Another product already uses this barcode.',
  users_email_unique: 'A user with this email already exists.',
  customers_phone_unique: 'A customer with this phone number already exists.',
  suppliers_name_unique: 'A supplier with this name already exists.',
  categories_name_unique: 'A category with this name already exists.',
  manufacturers_name_unique: 'A manufacturer with this name already exists.',
  product_batches_quantity_on_hand_check: 'Not enough stock in this batch.',
  sales_idempotency_key_key: 'This sale was already submitted.',
};

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.path}` } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    const first = err.issues[0];
    res.status(400).json({
      error: { code: 'VALIDATION', message: first ? first.message : 'Please check the form.', fields },
    });
    return;
  }
  const pg = err as PgError;
  if (pg?.code === '23505' || pg?.code === '23514' || pg?.code === '23503') {
    const message =
      (pg.constraint && CONSTRAINT_MESSAGES[pg.constraint]) ||
      (pg.code === '23503' ? 'This record is linked to other records and cannot be changed this way.' : 'This change conflicts with existing data.');
    logger.warn({ constraint: pg.constraint, detail: pg.detail }, 'Constraint violation');
    res.status(409).json({ error: { code: 'CONFLICT', message } });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed request body.' } });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request is too large.' } });
    return;
  }
  logger.error({ err, path: req.path, method: req.method, userId: req.actor?.userId }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
}
