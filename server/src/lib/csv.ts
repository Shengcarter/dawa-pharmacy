import type { Response } from 'express';
import { pool } from '../db/pool';
import { audit } from './audit';
import { logger } from './logger';

const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180 cell, with spreadsheet formula injection neutralised. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function sendCsv<T>(res: Response, filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','));
  // Bulk data leaving the system is a security-relevant event.
  const actor = res.req.actor;
  if (actor) {
    audit(pool, actor, {
      action: 'export', module: 'data', entityType: 'export', entityId: filename,
      summary: `${actor.userName} exported ${rows.length} row${rows.length === 1 ? '' : 's'} to ${filename}`,
      newValues: { path: res.req.originalUrl.split('?')[0], query: res.req.query as Record<string, unknown> },
    }).catch((err) => logger.error({ err }, 'Export audit failed'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}
