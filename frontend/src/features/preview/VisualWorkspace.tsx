import { useEffect, useRef, useState, type FormEvent } from 'react';
import NavIcon from '../../components/NavIcon';
import { ApiError, workspace } from '../../api/client';
import { money, shortDate, stages, type PreviewClient, type PreviewContent, type PreviewDeal, type PreviewInvoice, type Stage } from './data';
import { pages, currentPage, Icon, UserAvatar, type Page, type Editor, type PreviewTheme, type PreviewProfile } from './PreviewParts';
import DealsPreview from './PreviewDeals';
import DashboardPreview from './PreviewDashboard';
import ClientsPreview from './PreviewClients';
import InvoicesPreview from './PreviewInvoices';
import SettingsPreview from './PreviewSettings';
import PreviewEditor from './PreviewEditor';
import './preview.css';
import './preview-shell.css';

export default function VisualWorkspace() {
  const [page, setPage] = useState<Page>(currentPage);
  const [clients, setClients] = useState<PreviewClient[]>([]);
  const [deals, setDeals] = useState<PreviewDeal[]>([]);
  const [invoices, setInvoices] = useState<PreviewInvoice[]>([]);
  const [ready, setReady] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [editor, setEditor] = useState<Editor>(null);
  const [editingDeal, setEditingDeal] = useState<PreviewDeal | null>(null);
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState('');
  const [profile, setProfile] = useState<PreviewProfile>({ name: '', username: '', email: '', avatar: '' });
  const [workspaceName, setWorkspaceName] = useState('');
  const [content, setContent] = useState<PreviewContent | null>(null);
  const [compact, setCompact] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [theme, setTheme] = useState<PreviewTheme>('system');
  const [deviceDark, setDeviceDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    workspace.preview(controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setClients(data.clients); setDeals(data.deals); setInvoices(data.invoices);
      setProfile(data.profile); setWorkspaceName(data.workspaceName); setContent(data.content);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setPreviewError(cause instanceof ApiError && cause.status === 403 ? 'Sign in to view this workspace preview.'
        : cause instanceof ApiError && cause.status === 404 ? 'No preview is available for this workspace.'
          : 'Unable to load the preview. Check your connection and try again.');
    }).finally(() => { if (!controller.signal.aborted) setReady(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const changed = () => { setPage(currentPage()); setMenu(false); setNotice(''); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setDeviceDark(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#080808"/><path d="M5 23 15 6l4 8 8-5-7 17-5-7-10 4Z" fill="#ffffff"/></svg>')}`;
    document.head.append(icon);
    document.title = 'MicroFlow · Preview';
    return () => { icon.remove(); document.title = previousTitle; };
  }, []);

  function navigate(next: Page) {
    setPage(next); setMenu(false); setNotice('');
    window.location.hash = `/${next.toLowerCase()}`;
  }

  function openEditor(next: Editor, deal: PreviewDeal | null = null) {
    setEditingDeal(deal); setEditor(next); setNotice('');
  }

  function saved(message: string) {
    setEditor(null); setEditingDeal(null); setNotice(`${message} Preview changes reset when you reload.`);
  }

  if (!ready) return <main className="auth-page"><p role="status">Loading preview…</p></main>;
  if (previewError) return <main className="auth-page"><div className="panel auth-card"><h1>Preview unavailable</h1><p role="alert" className="auth-description">{previewError}</p><a href="/login">Sign in</a> · <a href="/">Back to application</a></div></main>;
  if (!content) return <main className="auth-page"><p role="alert">Preview content is unavailable.</p></main>;

  return <div className={`visual-workspace ${compact ? 'pv-compact' : ''} ${reducedMotion ? 'pv-reduced-motion' : ''}`} data-preview-theme={theme === 'system' ? (deviceDark ? 'dark' : 'light') : theme}>
    <a className="skip-link" href="#preview-content" onClick={event => { event.preventDefault(); document.getElementById('preview-content')?.focus(); }}>Skip to content</a>
    <header className="pv-topbar"><div className="pv-brand"><span className="pv-brand-symbol" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 23 15 6l4 8 8-5-7 17-5-7-10 4Z" fill="currentColor" /></svg></span><span>MicroFlow</span></div><nav aria-label="Preview top navigation">{pages.filter(name => name !== 'Settings' && name !== 'Dashboard').map(name => <button key={name} className={page === name ? 'active' : ''} aria-current={page === name ? 'page' : undefined} onClick={() => navigate(name)}><NavIcon page={name} />{name}</button>)}</nav><a className="pv-topbar-back" href="/">Back to application</a><button className="pv-topbar-user" aria-label="Open preview settings" onClick={() => navigate('Settings')}><UserAvatar profile={profile} /></button></header>
    <aside className={`pv-sidebar ${menu ? 'is-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape') { setMenu(false); menuRef.current?.focus(); } }}>
      <div className="pv-brand"><span className="pv-brand-symbol" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 23 15 6l4 8 8-5-7 17-5-7-10 4Z" fill="currentColor" /></svg></span><span>Micro<span className="pv-brand-accent">Flow</span></span><button ref={menuRef} className="pv-menu" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="preview-navigation" onClick={() => setMenu(!menu)}>☰</button></div>
      <div className="pv-sidebar-body" id="preview-navigation">
        <div className="pv-workspace"><span className="pv-workspace-mark">{workspaceName.charAt(0).toUpperCase()}</span><div><strong>{workspaceName}</strong><small>Sample workspace</small></div></div>
        <p className="pv-nav-caption">WORKSPACE</p>
        <nav aria-label="Preview navigation">{pages.filter(name => name !== 'Settings').map(name => <button key={name} className={`pv-nav-item ${page === name ? 'active' : ''}`} aria-current={page === name ? 'page' : undefined} onClick={() => navigate(name)}><NavIcon page={name} /><span>{name}</span>{name === 'Deals' && <small>{deals.length}</small>}{name === 'Clients' && <small>{clients.length}</small>}{name === 'Invoices' && <small>{invoices.length}</small>}</button>)}</nav>
        <div className="pv-sidebar-bottom"><button className={`pv-nav-item pv-sidebar-settings ${page === 'Settings' ? 'active' : ''}`} aria-current={page === 'Settings' ? 'page' : undefined} onClick={() => navigate('Settings')}><NavIcon page="Settings" /><span>Settings</span></button><div className="pv-preview-note"><span className="pv-spark">✧</span><strong>Your workspace, simplified.</strong><p>Less admin. More room for good work.</p></div><button className="pv-user" onClick={() => navigate('Settings')}><UserAvatar profile={profile} /><div><strong>{profile.name}</strong><small>Preview profile</small></div><Icon name="arrow" /></button></div>
      </div>
    </aside>
    <main className="pv-main" id="preview-content" tabIndex={-1}>
      <div className="pv-content">
        <header className="pv-page-heading"><div><h1>{page === 'Dashboard' ? 'A little clarity for your day.' : page}</h1><p className="muted">{{ Dashboard: 'Your pipeline, relationships and revenue. All in one place.', Deals: 'From the first hello to the final handoff.', Clients: 'Good relationships are the heart of good business.', Invoices: 'Beautifully simple billing. Keep every detail in order.', Settings: 'Make this space feel like yours.' }[page]}</p></div><div className="pv-quick-actions" role="group" aria-label="Page actions">{page === 'Dashboard' && <><button className="pv-button secondary" onClick={() => openEditor('client')}><Icon name="plus" />New client</button><button className="pv-button primary" onClick={() => navigate('Deals')}><Icon name="arrow" />Explore deals</button></>}{page === 'Deals' && <><button className="pv-button secondary" onClick={() => navigate('Clients')}><Icon name="arrow" />View clients</button><button className="pv-button primary" onClick={() => openEditor('deal')}><Icon name="plus" />New deal</button></>}{page === 'Clients' && <><button className="pv-button secondary" onClick={() => navigate('Deals')}><Icon name="arrow" />View deals</button><button className="pv-button primary" onClick={() => openEditor('client')}><Icon name="plus" />New client</button></>}{page === 'Invoices' && <><button className="pv-button secondary" onClick={() => navigate('Clients')}><Icon name="arrow" />View clients</button><button className="pv-button primary" onClick={() => openEditor('invoice')}><Icon name="file" />Create invoice</button></>}</div></header>
        {notice && <div className="pv-toast" role="status"><Icon name="check" />{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
        {page === 'Deals' && <DealsPreview deals={deals} clients={clients} profile={profile} content={content} defaultCurrency={defaultCurrency} onEdit={deal => openEditor('deal', deal)} onStatus={(id, status) => { setDeals(current => current.map(deal => deal.id === id ? { ...deal, status } : deal)); setNotice('Status changed in the preview only.'); }} />}
        {page === 'Dashboard' && <DashboardPreview deals={deals} invoices={invoices} clients={clients} onNavigate={navigate} />}
        {page === 'Clients' && <ClientsPreview clients={clients} deals={deals} profile={profile} content={content} />}
        {page === 'Invoices' && <InvoicesPreview invoices={invoices} clients={clients} workspaceName={workspaceName} profile={profile} content={content} />}
        {page === 'Settings' && <SettingsPreview profile={profile} onProfile={setProfile} workspaceName={workspaceName} onWorkspaceName={setWorkspaceName} compact={compact} onCompact={setCompact} reducedMotion={reducedMotion} onReducedMotion={setReducedMotion} defaultCurrency={defaultCurrency} onDefaultCurrency={setDefaultCurrency} theme={theme} onTheme={setTheme} onSaved={setNotice} />}
        <footer className="pv-footer"><span>A calmer way to work.</span><span>MicroFlow · Visual preview</span></footer>
      </div>
    </main>
    {editor && <PreviewEditor kind={editor} clients={clients} deal={editingDeal} workspaceName={workspaceName} profile={profile} content={content} onClose={() => setEditor(null)} onClient={client => { setClients(current => [...current, client]); saved('Client added.'); }} onDeal={deal => { setDeals(current => editingDeal ? current.map(item => item.id === deal.id ? deal : item) : [...current, deal]); saved(editingDeal ? 'Deal updated.' : 'Deal added.'); }} onInvoice={invoice => { setInvoices(current => [invoice, ...current]); saved('Invoice draft added.'); }} />}
  </div>;
}

