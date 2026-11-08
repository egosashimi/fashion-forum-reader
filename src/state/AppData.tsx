import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadFeed, loadManifest } from '../lib/data';
import type { Manifest, SourceInfo, Thread } from '../lib/types';

interface AppData {
  manifest: Manifest | null;
  feed: Thread[];
  feedGeneratedAt?: string;
  feedDays: number;
  loading: boolean;
  error: string | null;
  source: (id: string | undefined) => SourceInfo | undefined;
  sourceForUrl: (url: string) => string | undefined;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [feed, setFeed] = useState<Thread[]>([]);
  const [meta, setMeta] = useState<{ generatedAt?: string; days: number }>({ days: 45 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadManifest(), loadFeed()])
      .then(([m, f]) => {
        if (cancelled) return;
        setManifest(m);
        setFeed(f.threads);
        setMeta({ generatedAt: f.generatedAt, days: f.days });
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AppData>(() => {
    const byId = new Map(manifest?.sources.map((s) => [s.id, s]));
    return {
      manifest,
      feed,
      feedGeneratedAt: meta.generatedAt,
      feedDays: meta.days,
      loading,
      error,
      source: (id) => (id ? byId.get(id) : undefined),
      sourceForUrl: (url) => {
        try {
          const host = new URL(url).host.replace(/^www\./, '');
          return manifest?.sources.find((s) => new URL(s.baseUrl).host.replace(/^www\./, '') === host)?.id;
        } catch {
          return undefined;
        }
      },
    };
  }, [manifest, feed, meta, loading, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData outside provider');
  return v;
}
