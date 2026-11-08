import { formatDateTime, pct, timeAgo } from '../lib/format';
import type { Manifest, SourceInfo } from '../lib/types';

export function statusLabel(s: SourceInfo): string {
  switch (s.status) {
    case 'ok':
      return 'OK';
    case 'partial':
      return 'Partial';
    case 'error':
      return 'Error';
    case 'blocked':
      return 'Blocked';
    default:
      return 'Not yet collected';
  }
}

export function CoverageBar({ value }: { value: number }) {
  return (
    <span className="bar" role="img" aria-label={`${pct(value)} indexed`}>
      <span style={{ width: `${Math.min(100, value * 100)}%` }} />
    </span>
  );
}

export function CoverageTable({ manifest, compact }: { manifest: Manifest; compact?: boolean }) {
  return (
    <div className="tablewrap">
      <table className="coverage">
        <thead>
          <tr>
            <th>Forum</th>
            <th>Status</th>
            <th>Indexed</th>
            {!compact && <th>Est. total</th>}
            <th>Coverage</th>
            <th>Last success</th>
          </tr>
        </thead>
        <tbody>
          {manifest.sources.map((s) => (
            <tr key={s.id}>
              <td>
                <span className="swatch" style={{ background: s.color }} /> {compact ? s.short : s.name}
              </td>
              <td>
                <span className={`status status--${s.status}`} title={s.lastError ?? undefined}>
                  {statusLabel(s)}
                </span>
              </td>
              <td>{s.indexed.toLocaleString()}</td>
              {!compact && <td>{s.estimated ? `${s.backfillComplete ? '' : '~'}${s.estimated.toLocaleString()}` : '–'}</td>}
              <td>
                <CoverageBar value={s.coverage} /> {pct(s.coverage)}
                {s.backfillComplete ? ' ✓' : ''}
              </td>
              <td title={formatDateTime(s.lastSuccessAt)}>{timeAgo(s.lastSuccessAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
