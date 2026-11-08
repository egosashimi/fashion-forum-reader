import { describe, expect, it } from 'vitest';
import { highlight, normalize, parseQuery, searchThreads, snippetFor } from '../lib/search';
import { THREADS } from './fixtures';

describe('query parsing', () => {
  it('splits terms and quoted phrases', () => {
    const q = parseQuery('Walls "duck canvas" hunting');
    expect(q.terms).toEqual(['walls', 'hunting']);
    expect(q.phrases).toEqual(['duck canvas']);
  });
  it('treats hyphenated words as phrases', () => {
    expect(parseQuery('usa-made').phrases).toEqual(['usa made']);
  });
  it('normalises case, accents and punctuation', () => {
    expect(normalize("Vanson's CAFÉ Racer!")).toBe('vansons cafe racer');
  });
});

describe('searching', () => {
  const hitIds = (q: string, opts = {}) => searchThreads(THREADS, parseQuery(q), opts).map((h) => h.thread.id);

  it('finds brands in titles', () => {
    expect(hitIds('kakadu')).toEqual(['vfg:5001']);
    expect(hitIds('Vanson')).toEqual(['fedoralounge:124285']);
  });
  it('finds terms in excerpts / post text', () => {
    expect(hitIds('Walls')).toEqual(['vlj:20130']);
    expect(hitIds('"hunting jacket"')).toEqual(['vlj:20130']);
    expect(hitIds('"usa made"')).toEqual(['vlj:20130']);
  });
  it('requires all terms (AND) and phrases to be adjacent', () => {
    expect(hitIds('"duck canvas"').sort()).toEqual(['vfg:5001', 'vlj:20130']);
    expect(hitIds('duck kakadu')).toEqual(['vfg:5001']);
    expect(hitIds('"canvas duck"')).toEqual([]);
  });
  it('matches at word starts, not inside words', () => {
    expect(hitIds('alls')).toEqual([]);
    expect(hitIds('selv')).toEqual(['ironheart:934']);
  });
  it('uses extra text from post chunks', () => {
    const hits = searchThreads(THREADS, parseQuery('sanforized'), { textFor: (id) => (id === 'ironheart:934' ? 'are these VMC 666s sanforized?' : undefined) });
    expect(hits.map((h) => h.thread.id)).toEqual(['ironheart:934']);
    expect(hits[0].inText).toBe(true);
    expect(hits[0].snippet).toContain('sanforized');
  });
  it('ranks title matches above text matches', () => {
    const hits = searchThreads(THREADS, parseQuery('duck canvas'));
    expect(hits[0].thread.id).toBe('vfg:5001');
  });
  it('sorts by newest, oldest and replies', () => {
    expect(hitIds('jacket', { sort: 'replies' })[0]).toBe('fedoralounge:82949');
    expect(hitIds('jacket', { sort: 'oldest' })[0]).toBe('fedoralounge:82949');
    expect(hitIds('jacket', { sort: 'newest' })[0]).toBe('vlj:20130');
  });
  it('returns nothing for empty queries', () => {
    expect(hitIds('   ')).toEqual([]);
  });
});

describe('highlighting', () => {
  it('marks matching words', () => {
    const segs = highlight('Kakadu Traders duck canvas coat', parseQuery('"duck canvas" kakadu'));
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['Kakadu', 'duck canvas']);
    expect(segs.map((s) => s.text).join('')).toBe('Kakadu Traders duck canvas coat');
  });
  it('does not mark inside words', () => {
    expect(highlight('Wallsend and walls', parseQuery('alls')).some((s) => s.match)).toBe(false);
  });
  it('makes a snippet around the first match', () => {
    const text = `${'x '.repeat(200)}Walls jacket ${'y '.repeat(200)}`;
    const s = snippetFor(text, parseQuery('walls'), 20);
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('Walls');
    expect(s.length).toBeLessThan(70);
  });
});
