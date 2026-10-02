import type { Tx } from '../db/pool';

/**
 * Gap-free document numbers per prefix and year, e.g. INV-2026-000123.
 * The row lock serialises concurrent callers inside their transactions.
 */
export async function nextDocumentNumber(tx: Tx, prefix: string, at: Date = new Date(), width = 6): Promise<string> {
  const year = at.getUTCFullYear();
  const key = `${prefix}-${year}`;
  const { rows } = await tx.query(
    `INSERT INTO document_sequences (key, last_value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value`,
    [key],
  );
  return `${prefix}-${year}-${String(rows[0].last_value).padStart(width, '0')}`;
}

/** Short sequential codes for master data, e.g. SUP-0012, CUS-00042. */
export async function nextCode(tx: Tx, prefix: string, width: number): Promise<string> {
  const { rows } = await tx.query(
    `INSERT INTO document_sequences (key, last_value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value`,
    [prefix],
  );
  return `${prefix}-${String(rows[0].last_value).padStart(width, '0')}`;
}
