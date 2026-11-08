import { useEffect, useMemo, useRef, useState } from 'react';
import { Chip, Empty, Notice, Segmented } from '../components/Bits';
import { CategorySelect, SelectField, SourcePicker, Toggle } from '../components/Filters';
import { SavedItemCard } from '../components/SavedItemCard';
import { ThreadRow } from '../components/ThreadRow';
import { getRegisteredThread, loadIndexChunk, loadTextChunk } from '../lib/data';
import { queryLibrary } from '../lib/library';
import { navigate, usePref, useRoute } from '../lib/router';
import { isEmptyQuery, parseQuery, searchThreads } from '../lib/search';
import { filterThreads } from '../lib/sort';
import type { SearchSort, Thread } from '../lib/types';
import { useAppData } from '../state/AppData';
import { useLibrary } from '../state/Library';

type Scope = 'index' | 'feed' | 'library';
const SUGGESTIONS = ['Walls', 'Kakadu', '"duck canvas"', '"USA made"', '"hunting jacket"', 'horsehide', 'Talon zipper', 'chore coat'];
const PAGE = 30;

export function SearchPage() {
  const { manifest, feed, feedDays } = useAppData();
  const { lib } = useLibrary();
  const route = useRoute();
  const q = route.params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [scope, setScope] = usePref<Scope>('search.scope', 'index');
  const [sources, setSources] = usePref<string[]>('search.sources', []);
  const [category, setCategory] = useState('');
  const [sort, setSort] = usePref<SearchSort>('search.sort', 'relevance');
  const [withText, setWithText] = usePref('search.text', true);
  const [limit, setLimit] = useState(PAGE);
  const [index, setIndex] = useState<Map<string, Thread[]>>(new Map());
  const [texts, setTexts] = useState<Map<string, string>>(new Map());
  const [textFiles, setTextFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setInput(q), [q]);
  useEffect(() => setLimit(PAGE), [q, scope, sources, category, sort]);
  const parsed = useMemo(() => parseQuery(q), [q]);
  const active = !isEmptyQuery(parsed);

  // Lazily fetch index (and text) chunks for the forums being searched.
  useEffect(() => {
    if (!manifest || scope !== 'index' || !active) return;
    const wanted = manifest.index.filter((c) => (!sources.length || sources.includes(c.source)) && !index.has(c.file));
    const wantedText = withText ? manifest.text.filter((c) => (!sources.length || sources.includes(c.source)) && !textFiles.has(c.file)) : [];
    if (!wanted.length && !wantedText.length) return;
    let off = false;
    let done = 0;
    const total = wanted.length + wantedText.length;
    setLoading({ done, total });
    const tick = () => !off && setLoading({ done: ++done, total });
    Promise.all([
      ...wanted.map((c) =>
        loadIndexChunk(c, manifest.sources.find((s) => s.id === c.source)!).then((rows) => {
          tick();
          return [c.file, rows] as const;
        }),
      ),
    ])
      .then(async (chunks) => {
        const textMaps = await Promise.all(wantedText.map((c) => loadTextChunk(c).then((m) => (tick(), [c.file, m] as const))));
        if (off) return;
        setIndex((prev) => new Map([...prev, ...chunks]));
        setTexts((prev) => {
          const next = new Map(prev);
          for (const [, m] of textMaps) for (const [k, v] of m) next.set(k, v);
          return next;
        });
        setTextFiles((prev) => new Set([...prev, ...textMaps.map(([file]) => file)]));
      })
      .catch((e: Error) => !off && setError(e.message))
      .finally(() => !off && setLoading(null));
    return () => {
      off = true;
    };
  }, [manifest, scope, active, sources, withText, index, textFiles]);

  const threadHits = useMemo(() => {
    if (!active || scope === 'library') return [];
    let pool: Thread[];
    if (scope === 'feed') pool = feed;
    else pool = [...index.values()].flat().map((t) => getRegisteredThread(t.id) ?? t);
    pool = filterThreads(pool, { sources, categories: category ? [category] : [] });
    return searchThreads(pool, parsed, { sort, textFor: withText ? (id) => texts.get(id) : undefined });
  }, [active, scope, feed, index, texts, sources, category, parsed, sort, withText]);

  const libraryHits = useMemo(() => (scope === 'library' && active ? queryLibrary(lib, { text: q, source: sources.length === 1 ? sources[0] : undefined, sort: sort === 'newest' ? 'published' : sort === 'oldest' ? 'published-asc' : 'saved' }) : []), [scope, active, lib, q, sources, sort]);

  if (!manifest) return null;
  const submit = (value: string) => navigate('search', { q: value.trim() || undefined }, true);
  const indexedTotal = manifest.sources.filter((s) => !sources.length || sources.includes(s.id)).reduce((n, s) => n + s.indexed, 0);
  const total = scope === 'library' ? libraryHits.length : threadHits.length;

  return (
    <section>
      <header className="page-head">
        <h1>Search</h1>
        <p className="muted">Search thread titles, authors and indexed post excerpts across every forum, or your own library. Use quotes for exact phrases.</p>
      </header>
      <form
        className="searchbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input ref={inputRef} type="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder='Brand, maker, material… e.g. Walls "duck canvas"' aria-label="Search" />
        <button className="btn btn--primary" type="submit">
          Search
        </button>
      </form>
      <div className="chips suggestions" aria-label="Example searches">
        {SUGGESTIONS.map((s) => (
          <Chip key={s} active={q === s} onClick={() => submit(s)}>
            {s.replace(/"/g, '')}
          </Chip>
        ))}
      </div>

      <div className="toolbar">
        <Segmented
          label="Search in"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'index', label: 'Historical index' },
            { value: 'feed', label: `Recent feed (${feedDays}d)` },
            { value: 'library', label: 'My library' },
          ]}
        />
        <SourcePicker sources={manifest.sources} selected={sources} onChange={(s) => { setSources(s); setCategory(''); }} />
        <div className="toolbar__row">
          {scope !== 'library' && <CategorySelect sources={manifest.sources} selectedSources={sources} value={category} onChange={setCategory} />}
          <SelectField
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'relevance', label: 'Relevance' },
              { value: 'newest', label: 'Newest' },
              { value: 'replies', label: 'Most replied' },
              { value: 'oldest', label: 'Oldest' },
            ]}
          />
          {scope !== 'library' && <Toggle label="Include post text" checked={withText} onChange={setWithText} title="Also search indexed opening-post and reply excerpts" />}
        </div>
      </div>

      {scope === 'index' && (
        <p className="muted small">
          Searching the historical index: {indexedTotal.toLocaleString()} threads indexed so far
          {manifest.historicalComplete ? '.' : ' (the backfill is still running, so older threads may be missing).'} Post text is limited to short excerpts of indexed posts.
        </p>
      )}
      {scope === 'feed' && <p className="muted small">Searching only threads active in the last {feedDays} days ({feed.length.toLocaleString()} threads).</p>}
      {error && <Notice kind="error">Could not load the search index: {error}</Notice>}
      {loading && (
        <p className="muted" aria-live="polite">
          Loading search index… {loading.done}/{loading.total}
        </p>
      )}

      {!active ? (
        <Empty title="Type a search to begin">Try a brand like “Walls” or a material like “duck canvas”.</Empty>
      ) : (
        <>
          <p className="count muted" aria-live="polite">
            {total.toLocaleString()} result{total === 1 ? '' : 's'} for <strong>{q}</strong>
          </p>
          {total === 0 && !loading && <Empty title="No matches">Check the spelling, remove a word, or search all forums.</Empty>}
          <div className="list" hidden={total === 0}>
            {scope === 'library'
              ? libraryHits.slice(0, limit).map((it) => <SavedItemCard key={it.id} item={it} query={parsed} />)
              : threadHits.slice(0, limit).map((h) => <ThreadRow key={h.thread.id} thread={h.thread} query={parsed} snippet={h.inText && !h.inTitle ? h.snippet : undefined} showExcerpt={false} />)}
          </div>
          {total > limit && (
            <button type="button" className="btn more" onClick={() => setLimit(limit + PAGE * 2)}>
              Show more ({(total - limit).toLocaleString()} left)
            </button>
          )}
        </>
      )}
    </section>
  );
}
