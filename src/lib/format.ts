export function formatCount(n: number | undefined, approx = false): string {
  if (n === undefined || n === null) return '–';
  let s: string;
  if (n >= 1_000_000) s = `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  else if (n >= 10_000) s = `${(n / 1000).toFixed(0)}K`;
  else if (n >= 1000) s = `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  else s = String(n);
  return approx ? `~${s}` : s;
}

export function exactCount(n: number | undefined, approx = false): string {
  if (n === undefined || n === null) return 'unknown';
  return `${approx ? 'about ' : ''}${n.toLocaleString()}${approx ? ' (the forum only shows a rounded figure)' : ''}`;
}

export function timeAgo(iso?: string | null, now = Date.now()): string {
  if (!iso) return '–';
  const t = Date.parse(iso);
  if (!t) return '–';
  const s = Math.round((now - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  const mo = Math.round(d / 30.4);
  if (mo < 24) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

/** Hours since an ISO timestamp (Infinity if missing). */
export const hoursSince = (iso?: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : Infinity);
