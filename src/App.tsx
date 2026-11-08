import { useEffect } from 'react';
import { Notice } from './components/Bits';
import { IconFeed, IconLibrary, IconMoon, IconSearch, IconSun, IconTrophy, IconEye } from './components/Icons';
import { hoursSince, timeAgo } from './lib/format';
import { usePref, useRoute } from './lib/router';
import { BestPage } from './pages/BestPage';
import { FeedPage } from './pages/FeedPage';
import { LibraryPage } from './pages/LibraryPage';
import { SearchPage } from './pages/SearchPage';
import { SourcesPage } from './pages/SourcesPage';
import { ThreadPage } from './pages/ThreadPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { useAppData } from './state/AppData';
import { useLibrary } from './state/Library';
import { watchlistMatches } from './lib/watchlist';

type Theme = 'system' | 'light' | 'dark';

const NAV = [
  { id: 'feed', label: 'Feed', icon: IconFeed },
  { id: 'best', label: 'Best of All Time', short: 'Best', icon: IconTrophy },
  { id: 'search', label: 'Search', icon: IconSearch },
  { id: 'watchlist', label: 'Watchlist', icon: IconEye },
  { id: 'library', label: 'Library', icon: IconLibrary },
];

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = usePref<Theme>('theme', 'system');
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  return [theme, () => setTheme(dark ? 'light' : 'dark')];
}

export function App() {
  const route = useRoute();
  const { manifest, loading, error, feed } = useAppData();
  const { lib } = useLibrary();
  const [theme, toggleTheme] = useTheme();
  const page = route.path[0];
  const isDark = theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, route.path[1]]);

  const newWatch = Object.values(lib.watchlists).reduce((n, w) => n + watchlistMatches(feed, w).filter((m) => m.isNew).length, 0);
  const stale = manifest && hoursSince(manifest.generatedAt) > 12;

  let content: React.ReactNode;
  if (loading) content = <p className="muted">Loading forum data…</p>;
  else if (error || !manifest)
    content = (
      <Notice kind="error">
        Could not load the forum data ({error}). If you are running locally, generate it first with <code>npm run data</code>. See the README.
      </Notice>
    );
  else
    switch (page) {
      case 'best':
        content = <BestPage />;
        break;
      case 'search':
        content = <SearchPage />;
        break;
      case 'watchlist':
        content = <WatchlistPage />;
        break;
      case 'library':
        content = <LibraryPage tab={route.path[1]} />;
        break;
      case 'thread':
        content = <ThreadPage id={route.path.slice(1).join('/')} />;
        break;
      case 'sources':
        content = <SourcesPage />;
        break;
      default:
        content = <FeedPage />;
    }

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href="#/feed">
          <span className="brand__mark" aria-hidden="true">
            ✂
          </span>
          <span>Vintage Forum Reader</span>
        </a>
        <nav className="topnav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={page === n.id ? 'active' : ''} aria-current={page === n.id ? 'page' : undefined}>
              {n.label}
              {n.id === 'watchlist' && newWatch > 0 && <span className="count-badge">{newWatch}</span>}
            </a>
          ))}
        </nav>
        <div className="topbar__right">
          {manifest && (
            <a href="#/sources" className={`freshness${stale ? ' freshness--stale' : ''}`} title={`Data generated ${manifest.generatedAt}`}>
              Updated {timeAgo(manifest.generatedAt)}
            </a>
          )}
          <button type="button" className="iconbtn" onClick={toggleTheme} aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`} title="Toggle theme">
            {isDark ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </header>
      <main id="main" className="main">
        {stale && <Notice kind="warn">Forum data has not been refreshed for over 12 hours. The scheduled collector may be failing. See Sources.</Notice>}
        {content}
      </main>
      <footer className="footer muted small">
        Thread titles, counts and short excerpts come from public forum pages and feeds, and every item links to the original discussion. Not affiliated
        with any forum. <a href="#/sources">Sources &amp; coverage</a>
      </footer>
      <nav className="tabbar" aria-label="Main">
        {NAV.map((n) => (
          <a key={n.id} href={`#/${n.id}`} className={page === n.id ? 'active' : ''} aria-current={page === n.id ? 'page' : undefined}>
            <n.icon />
            <span>{n.short ?? n.label}</span>
            {n.id === 'watchlist' && newWatch > 0 && <span className="count-badge">{newWatch}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}
