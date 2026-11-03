import { useEffect, useState } from 'react';
import { ApiError, auth, type User } from '../api/client';
import LoginForm from '../features/auth/LoginForm';
import ClientsPage from '../features/clients/ClientsPage';
import QuickActions from '../components/QuickActions';

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
  const [createRequested, setCreateRequested] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);

  useEffect(() => {
    const changed = () => setPage(currentPage());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  function navigate(next: Page) {
    setPage(next);
    window.location.hash = `/${next.toLowerCase()}`;
  }

  const themeButton = <button className="secondary theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
    aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? 'Dark theme' : 'Light theme'}</button>;

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
    try { await auth.logout(); setUser(null); setError(''); setCreateRequested(false); }
    catch { setError('Unable to sign out. Please try again.'); }
  }

  if (loading) return <p role="status" className="p-10">Loading…</p>;
  if (!user) return <><div className="login-theme">{themeButton}</div>{error && <p role="alert" className="notice error">{error}</p>}<LoginForm onLogin={setUser} /></>;

  return <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
    <aside className="sidebar flex flex-col p-6">
      <div className="mb-10 text-lg font-bold tracking-tight">micro<span className="accent">crm</span><span className="ml-2 text-xs font-normal muted">workspace</span></div>
      <p className="mb-3 text-[10px] font-semibold tracking-widest muted">WORKSPACE</p>
      <nav aria-label="Main navigation" className="flex flex-wrap gap-2 md:flex-col">
        {pages.map((name, index) => <button key={name} onClick={() => navigate(name)}
          aria-current={page === name ? 'page' : undefined}
          className={`nav-item flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${page === name ? 'active' : ''}`}>
          <span aria-hidden="true" className="text-xs opacity-60">0{index + 1}</span>{name}
        </button>)}
      </nav>
      <div className="account-menu mt-10 pt-5 md:mt-auto">
        <p className="truncate text-sm font-medium">{user.username}</p>
        <button onClick={logout} className="text-action mt-2 text-xs">Sign out</button>
        <div className="mt-4">{themeButton}</div>
      </div>
    </aside>
    <main className="workspace-main p-6 md:p-12">
      <header className="workspace-header mb-8 pb-8">
        <p className="mb-3 text-xs muted">Workspace / {page}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{page}</h1>
        <p className="mt-3 mb-6 text-sm muted">{descriptions[page]}</p>
        <QuickActions onNewClient={() => { navigate('Clients'); setCreateRequested(true); }} />
      </header>
      {error && <p role="alert" className="notice error">{error}</p>}
      {page === 'Clients' ? <ClientsPage key={user.id} createRequested={createRequested} onCreateHandled={() => setCreateRequested(false)} /> : page === 'Settings' ? <section className="panel max-w-xl p-8">
        <h2 className="mb-5 font-semibold">Account</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm"><dt className="muted">Username</dt><dd>{user.username}</dd>
          <dt className="muted">Email</dt><dd>{user.email || 'Not provided'}</dd></dl>
      </section> : <section className="panel grid min-h-80 place-content-center p-10 text-center">
        <div aria-hidden="true" className="empty-icon">◇</div>
        <h2 className="text-lg font-medium">Your work starts here</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 muted">The {page} section is not available yet. Your account is ready.</p>
      </section>}
    </main>
  </div>;
}
