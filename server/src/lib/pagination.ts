import type { Paginated } from '@dawa/shared';

export function pageParams(page: number, pageSize: number) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

export function paginated<T>(data: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { data, total, page, pageSize };
}

/** Maps a whitelisted sort key to a SQL expression; unknown keys fall back to the default. */
export function orderBy(map: Record<string, string>, sort: string | undefined, order: 'asc' | 'desc' | undefined, fallback: string): string {
  const expr = sort ? map[sort] : undefined;
  if (!expr) return fallback;
  return `${expr} ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;
}

/** Escapes LIKE wildcards in user search text. */
export const likeParam = (search: string) => `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
