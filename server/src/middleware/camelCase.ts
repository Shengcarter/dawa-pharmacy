import type { NextFunction, Request, Response } from 'express';

const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[toCamel(k)] = camelize(v);
    return out;
  }
  return value;
}

/**
 * The database speaks snake_case and the API speaks camelCase. Converting at
 * the response boundary keeps SQL readable and every response consistent.
 */
export function camelCaseResponses(_req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (body?: unknown) => json(camelize(body));
  next();
}
