// Minimal hash router: GitHub Pages serves one index.html, so routes live in
// the fragment (#/search?q=walls) and survive reloads and sharing.
import { useEffect, useState } from 'react';

export interface Route {
  path: string[]; // e.g. ["library", "posts"]
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [p, q = ''] = h.split('?');
  const path = p.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: path.length ? path : ['feed'], params: new URLSearchParams(q) };
}

export function href(path: string | string[], params?: Record<string, string | undefined>): string {
  const parts = (Array.isArray(path) ? path : [path]).map(encodeURIComponent).join('/');
  const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString() : '';
  return `#/${parts}${qs ? `?${qs}` : ''}`;
}

export function navigate(path: string | string[], params?: Record<string, string | undefined>, replace = false): void {
  const h = href(path, params);
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Small per-browser convenience storage (filters, theme). Never required. */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`vfr:${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(`vfr:${key}`, JSON.stringify(nv));
    } catch {
      /* private mode etc. */
    }
  };
  return [v, set];
}
