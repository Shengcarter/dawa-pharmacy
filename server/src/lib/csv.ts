import type { Response } from 'express';

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
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}
