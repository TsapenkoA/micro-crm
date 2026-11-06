import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ApiError, auth, workspace, type User, type WorkspaceCounts } from '../api/client';
import AuthScreen, { authPaths } from '../features/auth/AuthScreen';
import AccountSettings from '../features/auth/AccountSettings';
import { navigateAuth } from '../features/auth/fields';
import ClientsPage from '../features/clients/ClientsPage';
import QuickActions from '../components/QuickActions';
import NavIcon from '../components/NavIcon';
import VisualWorkspace from '../features/preview/VisualWorkspace';
import DealsPage from '../features/deals/DealsPage';

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const InvoicesPage = lazy(() => import('../features/invoices/InvoicesPage'));

const pages = ['Dashboard', 'Deals', 'Clients', 'Invoices', 'Settings'] as const;
type Page = typeof pages[number];
function currentPage(): Page {
  return pages.find(page => window.location.hash.split('?')[0] === `#/${page.toLowerCase()}`) ?? 'Dashboard';
}
const descriptions: Record<Page, string> = {
  Dashboard: 'A clear view of the work ahead.',
  Deals: 'From the first hello to the final handoff.',
  Clients: 'Good relationships are the heart of good business.',
  Invoices: 'Keep the details of your work in order.',
  Settings: 'A shared home for your business.',
};

function Application() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>(currentPage);
  const [path, setPath] = useState(window.location.pathname);
  const [createRequested, setCreateRequested] = useState(false);
  const [createDealRequested, setCreateDealRequested] = useState(false);
  const [createInvoiceRequested, setCreateInvoiceRequested] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [counts, setCounts] = useState<WorkspaceCounts | null>(null);
  const [countsRevision, setCountsRevision] = useState(0);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      let preference = 'system';
      try { preference = localStorage.getItem('theme') || 'system'; } catch {}
      document.documentElement.dataset.theme = preference === 'light' || preference === 'dark' ? preference : media.matches ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

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

  useEffect(() => {
    if (!user) { setCounts(null); return; }
    const controller = new AbortController();
    workspace.counts(controller.signal).then(setCounts).catch(() => { if (!controller.signal.aborted) setCounts(null); });
    return () => controller.abort();
  }, [user?.id, page, countsRevision]);

  const refreshCounts = () => setCountsRevision(value => value + 1);

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

  return <div className="application-workspace">
    <a className="skip-link" href="#workspace-content" onClick={event => { event.preventDefault(); document.getElementById('workspace-content')?.focus(); }}>Skip to content</a>
    <aside className="sidebar flex flex-col" onKeyDown={event => {
      if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
    }}>
      <div className="sidebar-brand"><div className="workspace-brand"><span className="workspace-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 23 15 6l4 8 8-5-7 17-5-7-10 4Z" fill="currentColor" /></svg></span><span>Micro<span className="accent">Flow</span></span></div>
        <button ref={menuButton} className="secondary menu-toggle" aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? 'Close menu' : 'Open menu'}</button></div>
      <div id="workspace-navigation" className={`sidebar-content ${menuOpen ? 'is-open' : ''}`}>
        <div className="workspace-identity" title={user.workspace?.name}><span className="workspace-initial" aria-hidden="true">{user.workspace?.name?.charAt(0).toUpperCase() || 'W'}</span><span><strong>{user.workspace?.name || 'Workspace unavailable'}</strong><small>Company workspace</small></span></div>
        <p className="workspace-nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {pages.map(name => <button key={name} onClick={() => navigate(name)}
            aria-current={page === name ? 'page' : undefined}
            className={`nav-item ${page === name ? 'active' : ''}`}>
            <NavIcon page={name} />{name}{name === 'Clients' || name === 'Deals' || name === 'Invoices' ? counts && <small className="nav-count" aria-hidden="true">{counts[name.toLowerCase() as keyof WorkspaceCounts]}</small> : null}
          </button>)}
        </nav>
        <div className="sidebar-bottom"><div className="workspace-sidebar-note"><span aria-hidden="true">✧</span><strong>Your workspace, simplified.</strong><p>Less admin. More room for good work.</p></div>
          <div className="account-menu"><button className="workspace-user" onClick={() => navigate('Settings')}><span className="workspace-user-avatar" aria-hidden="true">{user.username.slice(0, 2).toUpperCase()}</span><span><strong>{user.username}</strong><small>{user.email || 'Your account'}</small></span><span className="workspace-user-arrow" aria-hidden="true">→</span></button></div></div>
      </div>
    </aside>
    <main id="workspace-content" tabIndex={-1} className={`workspace-main ${page === 'Deals' ? 'deals-workspace' : ''}`}>
      <div className="workspace-exit-row"><button className="workspace-sign-out" onClick={logout}>Sign out <span aria-hidden="true">→</span></button></div>
      <header className="workspace-header">
        <div><h1>{page}</h1><p className="muted">{descriptions[page]}</p></div>
        <QuickActions page={page} onNavigate={navigate} onNewClient={() => { navigate('Clients'); setCreateRequested(true); }} onNewDeal={() => { navigate('Deals'); setCreateDealRequested(true); }} onNewInvoice={() => { navigate('Invoices'); setCreateInvoiceRequested(true); }} />
      </header>
      {error && <p role="alert" className="notice error">{error}</p>}
      {page === 'Dashboard' ? <Suspense fallback={<p role="status">Loading dashboard…</p>}><DashboardPage key={user.id} onNavigate={navigate} /></Suspense> : page === 'Deals' ? <DealsPage key={user.id} createRequested={createDealRequested} onCreateHandled={() => setCreateDealRequested(false)} onCountChanged={refreshCounts} showCreate={false} /> : page === 'Clients' ? <ClientsPage key={user.id} createRequested={createRequested} onCreateHandled={() => setCreateRequested(false)} onCountChanged={refreshCounts} /> : page === 'Invoices' ? <Suspense fallback={<p role="status">Loading invoices…</p>}><InvoicesPage key={user.id} createRequested={createInvoiceRequested} onCreateHandled={() => setCreateInvoiceRequested(false)} onCountChanged={refreshCounts} workspaceName={user.workspace?.name || 'Your workspace'} userEmail={user.email} /></Suspense> : page === 'Settings' ? <AccountSettings key={user.id} user={user} onUserUpdated={setUser} /> : <section className="panel grid min-h-80 place-content-center p-10 text-center">
        <div aria-hidden="true" className="empty-icon">◇</div>
        <h2 className="text-lg font-medium">Your work starts here</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 muted">The {page} section is not available yet. Your account is ready.</p>
      </section>}
    </main>
  </div>;
}

export default function App() {
  return window.location.pathname === '/preview' ? <VisualWorkspace /> : <Application />;
}
