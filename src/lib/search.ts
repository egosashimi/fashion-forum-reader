// Client-side search over thread metadata, excerpts and saved items.
import type { SearchSort, Thread } from './types';

export interface ParsedQuery {
  terms: string[]; // normalised single words
  phrases: string[]; // normalised multi-word phrases ("duck canvas")
  raw: string;
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** `walls "duck canvas" usa-made` -> terms [walls, usa, made]... phrases ["duck canvas"].
 * Unquoted hyphenated words become a phrase ("usa-made" -> "usa made"). */
export function parseQuery(q: string): ParsedQuery {
  const phrases: string[] = [];
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const chunk = normalize(m[1] ?? m[2]);
    if (!chunk) continue;
    if (chunk.includes(' ')) phrases.push(chunk);
    else terms.push(chunk);
  }
  return { terms: [...new Set(terms)], phrases: [...new Set(phrases)], raw: q };
}

export const isEmptyQuery = (q: ParsedQuery) => q.terms.length === 0 && q.phrases.length === 0;

/** Does normalised `hay` contain `term` at the start of a word? */
function hasWordPrefix(hay: string, term: string): boolean {
  let i = hay.indexOf(term);
  while (i >= 0) {
    if (i === 0 || hay[i - 1] === ' ') return true;
    i = hay.indexOf(term, i + 1);
  }
  return false;
}

function hasExactWord(hay: string, term: string): boolean {
  return ` ${hay} `.includes(` ${term} `);
}

function hasPhrase(hay: string, phrase: string): boolean {
  return ` ${hay} `.includes(` ${phrase} `) || hasWordPrefix(hay, phrase);
}

export interface SearchFields {
  title: string;
  text?: string; // excerpts / post text
  author?: string;
  category?: string;
  extra?: string; // e.g. tags and notes for library items
}

export interface MatchResult {
  score: number;
  inTitle: boolean;
  inText: boolean;
}

/** All terms and phrases must match somewhere (AND). Returns null if not. */
export function matchFields(fields: SearchFields, q: ParsedQuery): MatchResult | null {
  const title = normalize(fields.title);
  const text = fields.text ? normalize(fields.text) : '';
  const author = fields.author ? normalize(fields.author) : '';
  const category = fields.category ? normalize(fields.category) : '';
  const extra = fields.extra ? normalize(fields.extra) : '';
  let score = 0;
  let inTitle = false;
  let inText = false;
  const check = (needle: string, phrase: boolean): boolean => {
    const has = phrase ? hasPhrase : hasWordPrefix;
    let hit = false;
    if (has(title, needle)) {
      score += phrase ? 25 : hasExactWord(title, needle) ? 12 : 8;
      inTitle = hit = true;
    }
    if (extra && has(extra, needle)) {
      score += phrase ? 10 : 6;
      hit = true;
    }
    if (author && has(author, needle)) {
      score += 4;
      hit = true;
    }
    if (category && has(category, needle)) {
      score += 2;
      hit = true;
    }
    if (text && has(text, needle)) {
      score += phrase ? 6 : 3;
      inText = hit = true;
    }
    return hit;
  };
  for (const p of q.phrases) if (!check(p, true)) return null;
  for (const t of q.terms) if (!check(t, false)) return null;
  return { score, inTitle, inText };
}

export interface ThreadHit {
  thread: Thread;
  score: number;
  inTitle: boolean;
  inText: boolean;
  snippet?: string;
}

export function searchThreads(
  threads: Iterable<Thread>,
  q: ParsedQuery,
  opts: { sort?: SearchSort; textFor?: (id: string) => string | undefined; limit?: number } = {},
): ThreadHit[] {
  if (isEmptyQuery(q)) return [];
  const hits: ThreadHit[] = [];
  for (const t of threads) {
    const text = [t.excerpt, opts.textFor?.(t.id)].filter(Boolean).join(' … ');
    const m = matchFields({ title: t.title, text, author: t.author, category: t.category }, q);
    if (!m) continue;
    // Popularity nudges relevance a little without dominating it.
    const score = m.score + Math.log10((t.replies ?? 0) + 1);
    hits.push({ thread: t, score, inTitle: m.inTitle, inText: m.inText, snippet: m.inText ? snippetFor(text, q) : undefined });
  }
  sortHits(hits, opts.sort ?? 'relevance');
  return opts.limit ? hits.slice(0, opts.limit) : hits;
}

const ts = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);

export function sortHits(hits: ThreadHit[], sort: SearchSort): void {
  const cmp: Record<SearchSort, (a: ThreadHit, b: ThreadHit) => number> = {
    relevance: (a, b) => b.score - a.score || (b.thread.replies ?? 0) - (a.thread.replies ?? 0),
    newest: (a, b) => ts(b.thread.createdAt ?? b.thread.lastPostAt) - ts(a.thread.createdAt ?? a.thread.lastPostAt),
    oldest: (a, b) =>
      (ts(a.thread.createdAt ?? a.thread.lastPostAt) || Infinity) - (ts(b.thread.createdAt ?? b.thread.lastPostAt) || Infinity),
    replies: (a, b) => (b.thread.replies ?? -1) - (a.thread.replies ?? -1) || b.score - a.score,
  };
  hits.sort(cmp[sort]);
}

// -- highlighting -----------------------------------------------------------------

export interface Segment {
  text: string;
  match: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Build a regex matching query words at word starts in *original* text. */
export function highlightRegex(q: ParsedQuery): RegExp | null {
  const parts = [...q.phrases.map((p) => p.split(' ').map(escapeRe).join('[^a-z0-9]+')), ...q.terms.map(escapeRe)];
  if (!parts.length) return null;
  parts.sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![a-z0-9])(${parts.join('|')})`, 'gi');
}

export function highlight(text: string, q: ParsedQuery): Segment[] {
  const re = highlightRegex(q);
  if (!re || !text) return [{ text, match: false }];
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), match: false });
    out.push({ text: text.slice(i, i + m[0].length), match: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out.length ? out : [{ text, match: false }];
}

export function snippetFor(text: string, q: ParsedQuery, radius = 90): string {
  const re = highlightRegex(q);
  if (!re) return text.slice(0, radius * 2);
  const m = re.exec(text);
  if (!m) return text.slice(0, radius * 2);
  const start = Math.max(0, m.index - radius);
  const end = Math.min(text.length, m.index + m[0].length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
