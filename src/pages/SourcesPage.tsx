import { Notice } from '../components/Bits';
import { CoverageBar, CoverageTable, statusLabel } from '../components/Coverage';
import { formatDateTime, pct, timeAgo } from '../lib/format';
import { useAppData } from '../state/AppData';

const ACCESS: Record<string, string> = {
  xenforo: 'Public RSS feeds, plus public section listings sorted by the forum itself (newest, most replies, most views)',
  nodebb: "The forum's official public read-only JSON API (/api)",
  invision: 'Public RSS feed and guest-visible listings and topic pages',
};

export function SourcesPage() {
  const { manifest } = useAppData();
  if (!manifest) return null;
  return (
    <section>
      <header className="page-head">
        <h1>Sources &amp; coverage</h1>
        <p className="muted">
          Data last generated {formatDateTime(manifest.generatedAt)} ({timeAgo(manifest.generatedAt)}). Collection runs about every three hours on GitHub Actions,
          with a small request budget per forum and at least 3 seconds between requests.
        </p>
      </header>
      {!manifest.historicalComplete && (
        <Notice kind="info">
          The historical index is <strong>not complete yet</strong>, so leaderboards are labelled “Indexed Threads”. Each run walks a few more pages of every forum's
          archive, oldest first, and continues where the last run stopped.
        </Notice>
      )}
      <CoverageTable manifest={manifest} />
      {manifest.sources.map((s) => (
        <div key={s.id} className="card source">
          <h2>
            <span className="swatch" style={{ background: s.color }} /> {s.name} <span className={`status status--${s.status}`}>{statusLabel(s)}</span>
          </h2>
          <p className="small">
            <a href={s.homepage} target="_blank" rel="noopener noreferrer">
              {s.homepage}
            </a>
          </p>
          <p className="small">
            <strong>Access method:</strong> {ACCESS[s.adapter] ?? s.adapter}. Only metadata and short excerpts are stored. Every item links back to the original.
          </p>
          {s.notes && <p className="small">{s.notes}</p>}
          {s.lastError && <Notice kind={s.status === 'blocked' ? 'warn' : 'error'}>Last problem: {s.lastError}</Notice>}
          <p className="small muted">
            Last attempt {timeAgo(s.lastAttemptAt)} · last success {timeAgo(s.lastSuccessAt)}
            {s.lastRun && ` · last run: ${s.lastRun.requests} requests, ${s.lastRun.new_threads} new and ${s.lastRun.updated_threads} refreshed threads, ${s.lastRun.new_posts} new posts`}
            {' · '}backfill: {s.backfillPagesWalked} pages walked{s.backfillCycle > 1 ? `, pass ${s.backfillCycle}` : ''}
            {s.topRefreshedAt ? ` · top lists checked ${timeAgo(s.topRefreshedAt)}` : ' · top lists not fully checked yet'}
            {` · posts indexed in ${s.postsIndexedThreads} threads`}
          </p>
          <div className="tablewrap">
            <table className="coverage">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Indexed</th>
                  <th>Est. total</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {s.categories.map((c) => {
                  const cov = c.estimated ? c.indexed / c.estimated : 0;
                  return (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.indexed.toLocaleString()}</td>
                      <td>
                        {c.estimateExact || c.backfillDone ? '' : '~'}
                        {c.estimated.toLocaleString()}
                      </td>
                      <td>
                        <CoverageBar value={cov} /> {pct(cov)} {c.backfillDone ? '✓ walked' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
