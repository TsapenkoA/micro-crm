import { useEffect, useState } from 'react';
import { ApiError, auth, type User } from '../api/client';
import LoginForm from '../features/auth/LoginForm';

const pages = ['Dashboard', 'Deals', 'Clients', 'Invoices', 'Settings'] as const;
type Page = typeof pages[number];
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
  const [page, setPage] = useState<Page>('Dashboard');

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
    try { await auth.logout(); setUser(null); setError(''); }
    catch { setError('Unable to sign out. Please try again.'); }
  }

  if (loading) return <p role="status" className="p-10">Loading…</p>;
  if (!user) return <>{error && <p role="alert" className="p-4 text-red-600">{error}</p>}<LoginForm onLogin={setUser} /></>;

  return <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
    <aside className="flex flex-col border-r border-slate-200 bg-white p-6">
      <div className="mb-10 text-lg font-bold tracking-tight">micro<span className="text-indigo-600">crm</span><span className="ml-2 text-xs font-normal text-slate-400">workspace</span></div>
      <p className="mb-3 text-[10px] font-semibold tracking-widest text-slate-400">WORKSPACE</p>
      <nav aria-label="Main navigation" className="flex flex-wrap gap-2 md:flex-col">
        {pages.map((name, index) => <button key={name} onClick={() => setPage(name)}
          aria-current={page === name ? 'page' : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${page === name ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
          <span aria-hidden="true" className="text-xs opacity-60">0{index + 1}</span>{name}
        </button>)}
      </nav>
      <div className="mt-10 border-t border-slate-100 pt-5 md:mt-auto">
        <p className="truncate text-sm font-medium">{user.username}</p>
        <button onClick={logout} className="mt-2 text-xs text-slate-500 hover:text-indigo-600">Sign out</button>
      </div>
    </aside>
    <main className="p-6 md:p-12">
      <header className="mb-10 border-b border-slate-200 pb-8">
        <p className="mb-3 text-xs text-slate-400">Workspace / {page}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{page}</h1>
        <p className="mt-3 text-sm text-slate-500">{descriptions[page]}</p>
      </header>
      {error && <p role="alert" className="mb-5 text-red-600">{error}</p>}
      {page === 'Settings' ? <section className="panel max-w-xl p-8">
        <h2 className="mb-5 font-semibold">Account</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm"><dt className="text-slate-500">Username</dt><dd>{user.username}</dd>
          <dt className="text-slate-500">Email</dt><dd>{user.email || 'Not provided'}</dd></dl>
      </section> : <section className="panel grid min-h-80 place-content-center p-10 text-center">
        <div aria-hidden="true" className="mx-auto mb-5 grid h-12 w-12 place-content-center rounded-xl bg-indigo-50 text-xl text-indigo-500">◇</div>
        <h2 className="text-lg font-medium">Your work starts here</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">The {page} section will be available in a later phase. Your account is ready.</p>
      </section>}
    </main>
  </div>;
}
