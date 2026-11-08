// Small sample of real thread metadata (from the collector's first run on
// 2026-11-08), reduced to what the tests need.
import { decodeThread } from '../lib/data';
import type { RawThread, Thread } from '../lib/types';

export const RAW: RawThread[] = [
  { id: 'fedoralounge:82949', s: 'fedoralounge', t: 'What Jacket Are You Wearing Today?', u: 'https://www.thefedoralounge.com/threads/what-jacket-are-you-wearing-today.82949/', c: 'Outerwear and Workwear', ci: 'outerwear-and-workwear.4', a: 'Edward', ca: '2015-06-01T10:00:00Z', la: '2026-11-08T16:00:00Z', r: 65000, v: 14000000, f: 2 | 4 | 8 },
  { id: 'fedoralounge:124285', s: 'fedoralounge', t: "Vanson's Whiskey Roma Vs Brandy Roma", u: 'https://www.thefedoralounge.com/threads/vansons-whiskey-roma-vs-brandy-roma.124285/', c: 'Outerwear and Workwear', ci: 'outerwear-and-workwear.4', a: 'onstar', ca: '2026-11-07T12:12:44Z', la: '2026-11-08T16:58:12Z', r: 15, v: 524, e: 'Does anyone have a pictures of Vanson\'s Whiskey Roma leather color?' },
  { id: 'fedoralounge:84057', s: 'fedoralounge', t: 'Links to Important Threads', u: 'https://www.thefedoralounge.com/threads/links-to-important-threads.84057/', c: 'Outerwear and Workwear', ci: 'outerwear-and-workwear.4', a: 'Dinerman', ca: '2015-11-13T16:48:46Z', la: '2025-08-10T17:26:34Z', r: 3, v: 52000, f: 1 | 8 | 16 },
  { id: 'ironheart:934', s: 'ironheart', t: 'IH-666-XHS - 25oz Selvedge Denim Slim Straight Cut Jeans - Indigo', u: 'https://forum.ironheart.co.uk/topic/934/ih-666-xhs', c: 'Bottoms', ci: '9', a: 'Giles', ca: '2011-09-02T06:05:34Z', la: '2026-11-01T23:53:10Z', r: 4599, v: 2200078 },
  { id: 'vlj:20130', s: 'vlj', t: 'General Leather vintage jacket - need help with maker', u: 'https://vintageleatherjackets.org/threads/general-leather-vintage-jacket-need-help-with-maker.20130/', c: 'Vintage', ci: 'vintage.7', a: 'jim', ca: '2019-04-02T10:00:00Z', la: '2019-05-01T10:00:00Z', r: 21, v: 3100, e: 'Walls hunting jacket with duck canvas shell, USA made label.' },
  { id: 'vfg:5001', s: 'vfg', t: 'Kakadu Traders duck canvas coat — dating help', u: 'https://forums.vintagefashionguild.org/threads/kakadu.5001/', c: 'Ask Questions Get Answers', ci: 'public-vintage-fashion-ask-questions-get-answers.39', ca: '2024-01-10T10:00:00Z', la: '2026-10-20T10:00:00Z', r: 8, v: 900 },
];

export const THREADS: Thread[] = RAW.map(decodeThread);
export const byId = (id: string) => THREADS.find((t) => t.id === id)!;
