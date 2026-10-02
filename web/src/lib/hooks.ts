import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * List state (page, search, filters, sort) kept in the URL so views are
 * shareable and survive refresh and back-navigation.
 */
export function useListState<T extends Record<string, string>>(defaults: T & { page?: string; pageSize?: string }) {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => {
    const out: Record<string, string> = { page: '1', pageSize: '25', ...defaults };
    params.forEach((v, k) => {
      out[k] = v;
    });
    return out as T & { page: string; pageSize: string; search?: string; sort?: string; order?: string };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const set = useCallback(
    (patch: Record<string, string | number | null | undefined>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '' || String(v) === (defaults as Record<string, string>)[k]) next.delete(k);
            else next.set(k, String(v));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaults],
  );
  return [state, set] as const;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const fn = () => setMatches(mql.matches);
    mql.addEventListener('change', fn);
    return () => mql.removeEventListener('change', fn);
  }, [query]);
  return matches;
}

export function applyTheme(theme: 'light' | 'dark' | 'system') {
  try {
    localStorage.setItem('dawa.theme', theme);
  } catch {
    /* storage unavailable */
  }
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
