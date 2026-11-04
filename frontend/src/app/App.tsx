import { useEffect, useRef, useState } from 'react';
import { ApiError, auth, type User } from '../api/client';
import AuthScreen, { authPaths } from '../features/auth/AuthScreen';
import AccountSettings from '../features/auth/AccountSettings';
import { navigateAuth } from '../features/auth/fields';
import ClientsPage from '../features/clients/ClientsPage';
import QuickActions from '../components/QuickActions';
import ThemeSelect from '../components/ThemeSelect';
import NavIcon from '../components/NavIcon';

const pages = ['Dashboard', 'Deals', 'Clients', 'Invoices', 'Settings'] as const;
type Page = typeof pages[number];
function currentPage(): Page {
  return pages.find(page => window.location.hash === `#/${page.toLowerCase()}`) ?? 'Dashboard';
}
const descriptions: Record<Page, string> = {
  Dashboard: 'An overview of your business.',
  Deals: 'Your deals and work in progress.',
  Clients: 'Contacts and interaction history.',
  Invoices: 'Invoices for your clients.',
  Settings: 'Your account and workspace.',
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>(currentPage);
  const [path, setPath] = useState(window.location.pathname);
  const [createRequested, setCreateRequested] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const changed = () => setPage(currentPage());
    const routeChanged = () => { setPath(window.location.pathname); setPage(currentPage()); };
    const expired = () => { setUser(null); setCreateRequested(false); setError('Your session has expired. Please sign in again.'); };
    const cleared = () => setUser(null);
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', routeChanged);
    window.addEventListener('session-expired', expired);
    window.addEventListener('session-cleared', cleared);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', routeChanged);
      window.removeEventListener('session-expired', expired);
      window.removeEventListener('session-cleared', cleared);
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user && !authPaths.includes(path)) navigateAuth('/login' + window.location.hash, true);
    if (user && ['/login', '/sign-up'].includes(path)) navigateAuth('/' + window.location.hash, true);
    if (user && path === '/oauth-result') {
      const status = new URLSearchParams(window.location.search).get('status');
      if (status === 'success' || status === 'connected') navigateAuth('/#/' + (status === 'connected' ? 'settings' : 'dashboard'), true);
    }
  }, [loading, user, path]);

  function navigate(next: Page) {
    setPage(next);
    window.location.hash = `/${next.toLowerCase()}`;
    if (menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
  }

  useEffect(() => {
    let active = true;
    auth.me().then(session => { if (active) setUser(session.user); })
      .catch(cause => {
        if (active && !(cause instanceof ApiError && cause.status === 403)) {
          setError('The server is unavailable. Check your connection and refresh the page.');
        }
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function logout() {
    try { await auth.logout(); setUser(null); setError(''); setCreateRequested(false); setMenuOpen(false); navigateAuth('/login' + window.location.hash, true); }
    catch { setError('Unable to sign out. Please try again.'); }
  }

  if (loading) return <p role="status" className="p-10">Loading…</p>;
  if (!user && !authPaths.includes(path)) return <p role="status" className="p-10">Opening sign-in…</p>;
  if (user && path === '/oauth-result' && ['success', 'connected'].includes(new URLSearchParams(window.location.search).get('status') ?? '')) return <p role="status" className="p-10">Completing sign-in…</p>;
  if (!user || ['/forgot-password', '/reset-password', '/oauth-result'].includes(path)) return <AuthScreen key={path} path={path} notice={error} onLogin={account => {
    setUser(account); setError(''); navigateAuth('/' + window.location.hash, true);
  }} />;

  return <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
    <a className="skip-link" href="#workspace-content" onClick={event => { event.preventDefault(); document.getElementById('workspace-content')?.focus(); }}>Skip to content</a>
    <aside className="sidebar flex flex-col p-6" onKeyDown={event => {
      if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
    }}>
      <div className="sidebar-brand"><div className="text-lg font-bold tracking-tight">micro<span className="accent">crm</span></div>
        <button ref={menuButton} className="secondary menu-toggle" aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? 'Close menu' : 'Open menu'}</button></div>
      <div id="workspace-navigation" className={`sidebar-content ${menuOpen ? 'is-open' : ''}`}>
        <p className="workspace-name muted" title={user.workspace?.name}>{user.workspace?.name || 'Workspace unavailable'}</p>
        <nav aria-label="Main navigation" className="flex flex-col gap-2">
          {pages.map(name => <button key={name} onClick={() => navigate(name)}
            aria-current={page === name ? 'page' : undefined}
            className={`nav-item flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${page === name ? 'active' : ''}`}>
            <NavIcon page={name} />{name}
          </button>)}
        </nav>
        <div className="account-menu mt-10 pt-5 md:mt-auto">
          <p className="truncate text-sm font-medium">{user.username}</p>
          <button onClick={logout} className="text-action mt-2 text-xs">Sign out</button>
          {page !== 'Settings' && <div className="mt-4"><ThemeSelect /></div>}
        </div>
      </div>
    </aside>
    <main id="workspace-content" tabIndex={-1} className="workspace-main p-6 md:p-12">
      <header className="workspace-header mb-8 pb-8">
        <p className="mb-3 text-xs muted">Workspace / {page}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{page}</h1>
        <p className="mt-3 mb-6 text-sm muted">{descriptions[page]}</p>
        <QuickActions onNewClient={() => { navigate('Clients'); setCreateRequested(true); }} />
      </header>
      {error && <p role="alert" className="notice error">{error}</p>}
      {page === 'Clients' ? <ClientsPage key={user.id} createRequested={createRequested} onCreateHandled={() => setCreateRequested(false)} /> : page === 'Settings' ? <AccountSettings key={user.id} user={user} onUserUpdated={setUser} /> : <section className="panel grid min-h-80 place-content-center p-10 text-center">
        <div aria-hidden="true" className="empty-icon">◇</div>
        <h2 className="text-lg font-medium">Your work starts here</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 muted">The {page} section is not available yet. Your account is ready.</p>
      </section>}
    </main>
  </div>;
}
