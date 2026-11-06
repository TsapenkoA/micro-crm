import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Dialog from '../../components/Dialog';
import NavIcon from '../../components/NavIcon';
import { ApiError, workspace } from '../../api/client';
import { money, shortDate, stages, type PreviewClient, type PreviewContent, type PreviewDeal, type PreviewInvoice, type Stage } from './data';
import './preview.css';

const pages = ['Dashboard', 'Deals', 'Clients', 'Invoices', 'Settings'] as const;
type Page = typeof pages[number];
type Editor = 'client' | 'deal' | 'invoice' | null;
type PreviewTheme = 'system' | 'light' | 'dark';
type PreviewProfile = { name: string; username: string; email: string; avatar: string };
const currentPage = () => pages.find(page => window.location.hash === `#/${page.toLowerCase()}`) ?? 'Deals';

function Icon({ name }: { name: 'search' | 'plus' | 'arrow' | 'grid' | 'table' | 'calendar' | 'file' | 'check' | 'settings' }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    grid: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="14" rx="1" /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 4v16" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></>,
    file: <><path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--surface)" /><circle cx="16" cy="12" r="2" fill="var(--surface)" /><circle cx="10" cy="18" r="2" fill="var(--surface)" /></>,
  };
  return <svg className="pv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Avatar({ client, small = false }: { client: PreviewClient; small?: boolean }) {
  return <span className={`pv-avatar tone-${client.color} ${small ? 'small' : ''}`} aria-hidden="true">{client.initials}</span>;
}

function Badge({ status }: { status: string }) {
  const stage = stages.find(item => item.id === status);
  return <span className={`pv-badge tone-${stage?.color ?? (status === 'sent' ? 'blue' : status === 'draft' ? 'gray' : 'green')}`}><i />{stage?.label ?? status[0].toUpperCase() + status.slice(1)}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="pv-empty"><span>◇</span><p>{children}</p><small>Try another search or filter.</small></div>;
}

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
    icon.href = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#222b51"/><path d="M5 23 15 6l4 8 8-5-7 17-5-7-10 4Z" fill="#b8afff"/></svg>')}`;
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
    <aside className={`pv-sidebar ${menu ? 'is-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape') { setMenu(false); menuRef.current?.focus(); } }}>
      <div className="pv-brand"><span className="pv-brand-symbol" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 23 15 6l4 8 8-5-7 17-5-7-10 4Z" fill="currentColor" /></svg></span><span>Micro<span className="pv-brand-accent">Flow</span></span><button ref={menuRef} className="pv-menu" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="preview-navigation" onClick={() => setMenu(!menu)}>☰</button></div>
      <div className="pv-sidebar-body" id="preview-navigation">
        <div className="pv-workspace"><span className="pv-workspace-mark">{workspaceName.charAt(0).toUpperCase()}</span><div><strong>{workspaceName}</strong><small>Sample workspace</small></div></div>
        <p className="pv-nav-caption">WORKSPACE</p>
        <nav aria-label="Preview navigation">{pages.map(name => <button key={name} className={`pv-nav-item ${page === name ? 'active' : ''}`} aria-current={page === name ? 'page' : undefined} onClick={() => navigate(name)}>{name === 'Settings' ? <Icon name="settings" /> : <NavIcon page={name} />}<span>{name}</span>{name === 'Deals' && <small>{deals.length}</small>}{name === 'Clients' && <small>{clients.length}</small>}{name === 'Invoices' && <small>{invoices.length}</small>}</button>)}</nav>
        <div className="pv-sidebar-bottom"><div className="pv-preview-note"><span className="pv-spark">✧</span><strong>Your workspace, simplified.</strong><p>Less admin. More room for good work.</p></div><button className="pv-user" onClick={() => navigate('Settings')}><UserAvatar profile={profile} /><div><strong>{profile.name}</strong><small>Preview profile</small></div><Icon name="arrow" /></button></div>
      </div>
    </aside>
    <main className="pv-main" id="preview-content" tabIndex={-1}>
      <div className="pv-content">
        <div className="pv-exit-row"><a href="/" className="pv-back-link"><Icon name="arrow" />Back to application</a></div>
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

function DealsPreview({ deals, clients, profile, content, defaultCurrency, onEdit, onStatus }: { deals: PreviewDeal[]; clients: PreviewClient[]; profile: PreviewProfile; content: PreviewContent; defaultCurrency: string; onEdit: (deal: PreviewDeal) => void; onStatus: (id: string, status: Stage) => void }) {
  const [view, setView] = useState('board');
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<string | null>(deals[0]?.id ?? null);
  const [detailTab, setDetailTab] = useState('overview');
  const trigger = useRef<HTMLButtonElement | null>(null);
  const filtered = deals.filter(deal => deal.currency === currency && (status === 'all' || deal.status === status) && `${deal.title} ${clients.find(client => client.id === deal.client)?.company}`.toLowerCase().includes(search.toLowerCase()));
  const selectedDeal = filtered.find(deal => deal.id === selected);
  const client = clients.find(item => item.id === selectedDeal?.client);
  const total = filtered.filter(deal => !['paid', 'archived'].includes(deal.status)).reduce((sum, deal) => sum + deal.amount, 0);
  function close() { setSelected(null); trigger.current?.focus(); }
  function open(deal: PreviewDeal, button: HTMLButtonElement) { trigger.current = button; setSelected(deal.id); setDetailTab('overview'); }
  return <section className="pv-deals-section" aria-label="Sample deals">
    <div className="pv-toolbar"><div className="pv-segment" role="group" aria-label="Deal view"><button aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name="grid" />Kanban</button><button aria-pressed={view === 'table'} onClick={() => setView('table')}><Icon name="table" />Table</button></div><label className="pv-search"><Icon name="search" /><input aria-label="Search sample deals" placeholder="Search deals or clients…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Filter deal status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select><select aria-label="Deal currency" value={currency} onChange={event => setCurrency(event.target.value)}><option>USD</option><option>EUR</option></select></div>
    <div className="pv-pipeline-caption"><span><strong>{filtered.length}</strong> deals <span className="pv-divider">/</span> Keep the next step in sight.</span><span>Active pipeline <strong>{money(total, currency)}</strong></span></div>
    <div className={`pv-deal-layout ${selectedDeal ? 'with-detail' : ''}`}>
      <div className="pv-board-area">{view === 'board' ? <div className="pv-board">{stages.map(stage => {
        const group = filtered.filter(deal => deal.status === stage.id);
        return <section className="pv-column" key={stage.id} aria-label={stage.label}><header><div><span className={`pv-stage-dot tone-${stage.color}`} /><h2>{stage.label}</h2><small>{group.length}</small></div><strong>{money(group.reduce((sum, deal) => sum + deal.amount, 0), currency)}</strong></header><div className="pv-cards">{group.map(deal => {
          const company = clients.find(item => item.id === deal.client)!;
          return <button className={`pv-deal-card ${selected === deal.id ? 'selected' : ''}`} key={deal.id} onClick={event => open(deal, event.currentTarget)} aria-label={`Open ${deal.title}`}><div className="pv-card-top"><Avatar client={company} small /><span className="pv-category">{deal.category}</span></div><h3>{deal.title}</h3><p>{company.company}</p><strong className="pv-card-amount">{money(deal.amount, currency)}</strong><div className="pv-card-bottom"><span><Icon name="calendar" />{shortDate(deal.deadline)}</span><span className="pv-owner" title="Sample team member">{profile.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span></div></button>;
        })}{!group.length && <p className="pv-column-empty">A little room for what’s next.</p>}</div></section>;
      })}</div> : <div className="pv-table-wrap"><table className="pv-table"><thead><tr><th>Deal</th><th>Client</th><th>Status</th><th>Amount</th><th>Deadline</th></tr></thead><tbody>{filtered.map(deal => <tr key={deal.id}><td><button className="pv-text-link" onClick={event => open(deal, event.currentTarget)}>{deal.title}</button><small>{deal.category}</small></td><td>{clients.find(client => client.id === deal.client)?.company}</td><td><Badge status={deal.status} /></td><td className="pv-number">{money(deal.amount, currency)}</td><td>{shortDate(deal.deadline)}</td></tr>)}</tbody></table>{!filtered.length && <Empty>No matching deals.</Empty>}</div>}</div>
      {selectedDeal && client && <aside className="pv-deal-detail" aria-label="Deal details" onKeyDown={event => { if (event.key === 'Escape') close(); }}><div className="pv-detail-top"><span className="pv-eyebrow">DEAL DETAILS</span><button className="pv-icon-button" onClick={close} aria-label="Close deal details">×</button></div><Avatar client={client} /><h2>{selectedDeal.title}</h2><p className="muted">{client.company}</p><div className="pv-detail-status"><Badge status={selectedDeal.status} /><span>Sample deal</span></div><div className="pv-detail-tabs"><button aria-pressed={detailTab === 'overview'} onClick={() => setDetailTab('overview')}>Overview</button><button aria-pressed={detailTab === 'notes'} onClick={() => setDetailTab('notes')}>Notes <small>1</small></button></div>{detailTab === 'overview' ? <><dl className="pv-detail-fields"><dt>Deal value</dt><dd className="pv-value">{money(selectedDeal.amount, selectedDeal.currency)} <small>{selectedDeal.currency}</small></dd><dt>Client</dt><dd><Avatar client={client} small />{client.company}</dd><dt>Deadline</dt><dd><Icon name="calendar" />{selectedDeal.deadline ? new Date(`${selectedDeal.deadline}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "No deadline"}</dd><dt>Created by</dt><dd><span className="pv-owner">{profile.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span> {profile.name}</dd><dt>Service</dt><dd>{selectedDeal.category}</dd></dl><div className="pv-detail-section"><h3>The next step</h3><p className="muted">{content.dealNextStep}</p></div><label className="pv-field">Stage<select value={selectedDeal.status} onChange={event => onStatus(selectedDeal.id, event.target.value as Stage)}>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label></> : <div className="pv-sample-note"><div><span className="pv-owner">{profile.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><strong>{profile.name}</strong><time>{content.dealNoteTime}</time></div><p>{content.dealNote}</p><small>Illustrative note · not saved</small></div>}<button className="pv-button secondary pv-full" onClick={() => onEdit(selectedDeal)}>Edit preview deal <Icon name="arrow" /></button><p className="pv-detail-disclaimer">Explore the layout. Changes here affect sample data only.</p></aside>}
    </div><p className="pv-board-footnote">Status changes are available in the detail panel. Drag-and-drop will be connected with the Deals workflow.</p>
  </section>;
}

function DashboardPreview({ deals, invoices, clients, onNavigate }: { deals: PreviewDeal[]; invoices: PreviewInvoice[]; clients: PreviewClient[]; onNavigate: (page: Page) => void }) {
  const [currency, setCurrency] = useState('USD');
  const [period, setPeriod] = useState('month');
  const matching = deals.filter(deal => deal.currency === currency);
  const paid = matching.filter(deal => deal.status === 'paid');
  const lost = matching.filter(deal => deal.status === 'archived' && deal.outcome === 'lost');
  const pipeline = matching.filter(deal => ['new_lead', 'negotiation', 'in_progress'].includes(deal.status)).reduce((sum, deal) => sum + deal.amount, 0);
  const revenue = currency === 'USD' ? invoices.filter(invoice => invoice.status === 'paid').reduce((sum, invoice) => sum + invoice.amount, 0) : 0;
  const monthValues = [6, 7, 8, 9, 10, 11].map(month => currency === 'USD' ? invoices.filter(invoice => invoice.status === 'paid' && Number(invoice.date.slice(5, 7)) === month).reduce((sum, invoice) => sum + invoice.amount, 0) : 0);
  const values = period === 'month' ? monthValues : [monthValues.slice(0, 3).reduce((sum, value) => sum + value, 0), monthValues.slice(3).reduce((sum, value) => sum + value, 0)];
  const labels = period === 'month' ? ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'] : ['Q3', 'Q4'];
  const chartMax = Math.max(1, Math.ceil(Math.max(...values) / 4) * 4);
  const points = values.map((value, index) => `${50 + index * (600 / (values.length - 1))},${210 - value / chartMax * 175}`).join(' ');
  return <section aria-label="Sample dashboard"><div className="pv-dashboard-toolbar"><span>A snapshot of your business</span><select aria-label="Dashboard currency" value={currency} onChange={event => setCurrency(event.target.value)}><option>USD</option><option>EUR</option></select></div><div className="pv-kpi-grid">{[
    ['Active pipeline', money(pipeline, currency), `${matching.filter(deal => ['new_lead', 'negotiation', 'in_progress'].includes(deal.status)).length} active opportunities`, 'blue'],
    ['Win rate', paid.length + lost.length ? `${Math.round(paid.length / (paid.length + lost.length) * 100)}%` : 'N/A', 'Paid vs. paid + lost deals', 'purple'],
    ['Average deal size', paid.length ? money(paid.reduce((sum, deal) => sum + deal.amount, 0) / paid.length, currency) : 'N/A', 'Across paid deals', 'amber'],
    ['Revenue', money(revenue, currency), 'Paid sample invoices · Jun–Nov', 'green'],
  ].map(([label, value, caption, color]) => <article className="pv-kpi" key={label}><div><span>{label}</span><span className={`pv-kpi-symbol tone-${color}`}>↗</span></div><strong>{value}</strong><p>{caption}</p></article>)}</div><div className="pv-dashboard-grid"><section className="pv-surface pv-revenue"><div className="pv-section-heading"><div><h2>Revenue overview</h2><p>From completed work to a healthy business.</p></div><div className="pv-segment"><button aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>Monthly</button><button aria-pressed={period === 'quarter'} onClick={() => setPeriod('quarter')}>Quarterly</button></div></div><div className="pv-chart-total"><strong>{money(revenue, currency)}</strong><span><i />Paid invoices</span></div><svg className="pv-revenue-chart" viewBox="0 0 700 260" role="img" aria-label={`Sample ${period === 'month' ? 'monthly' : 'quarterly'} revenue in ${currency}`}><defs><linearGradient id="pv-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>{[0, 1, 2, 3, 4].map(step => { const value = step * chartMax / 4; return <g key={value}><line x1="50" x2="670" y1={210 - value / chartMax * 175} y2={210 - value / chartMax * 175} className="pv-chart-grid" /><text x="0" y={214 - value / chartMax * 175}>{value ? money(value, currency) : '0'}</text></g>; })}<polygon points={`50,210 ${points} 650,210`} fill="url(#pv-chart-fill)" /><polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" />{values.map((value, index) => <g key={labels[index]}><circle cx={50 + index * (600 / (values.length - 1))} cy={210 - value / chartMax * 175} r="4" fill="var(--accent)"><title>{labels[index]}: {money(value, currency)}</title></circle><text x={50 + index * (600 / (values.length - 1))} y="245" textAnchor="middle">{labels[index]}</text></g>)}</svg></section><section className="pv-surface"><div className="pv-section-heading"><div><h2>Pipeline at a glance</h2><p>Every opportunity, in perspective.</p></div></div><div className="pv-pipeline-total"><strong>{matching.length}</strong><span>sample deals</span></div><div className="pv-status-bars">{stages.map(stage => { const count = matching.filter(deal => deal.status === stage.id).length; return <div key={stage.id}><div><span><i className={`pv-stage-dot tone-${stage.color}`} />{stage.label}</span><strong>{count}</strong></div><div className="pv-bar-track"><i className={`tone-${stage.color}`} style={{ width: `${count / Math.max(matching.length, 1) * 100}%` }} /></div></div>; })}</div></section></div><section className="pv-surface pv-recent"><div className="pv-section-heading"><div><h2>On your radar</h2><p>A few things to keep moving.</p></div><button className="pv-text-link" onClick={() => onNavigate('Deals')}>View all deals <Icon name="arrow" /></button></div><div className="pv-table-wrap"><table className="pv-table"><thead><tr><th>Deal / client</th><th>Status</th><th>Deadline</th><th>Value</th></tr></thead><tbody>{matching.filter(deal => ['negotiation', 'in_progress'].includes(deal.status)).slice(0, 4).map(deal => <tr key={deal.id}><td><strong>{deal.title}</strong><small>{clients.find(client => client.id === deal.client)?.company}</small></td><td><Badge status={deal.status} /></td><td><span className="pv-date"><Icon name="calendar" />{shortDate(deal.deadline)}</span></td><td className="pv-number">{money(deal.amount, currency)}</td></tr>)}</tbody></table>{!matching.length && <Empty>No opportunities in this currency.</Empty>}</div></section></section>;
}

function ClientsPreview({ clients, deals, profile, content }: { clients: PreviewClient[]; deals: PreviewDeal[]; profile: PreviewProfile; content: PreviewContent }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PreviewClient | null>(null);
  const filtered = clients.filter(client => `${client.name} ${client.company} ${client.email}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="pv-surface"><div className="pv-toolbar"><label className="pv-search"><Icon name="search" /><input aria-label="Search sample clients" placeholder="Search by name, company or email…" value={search} onChange={event => setSearch(event.target.value)} /></label><span className="pv-toolbar-caption">{clients.length} relationships, one shared workspace</span></div><div className="pv-table-wrap"><table className="pv-table pv-client-table"><thead><tr><th>Client</th><th>Company</th><th>Email</th><th>Phone</th><th>Deals</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{filtered.map(client => <tr key={client.id}><td><button className="pv-client-cell" onClick={() => setSelected(client)}><Avatar client={client} /><span><strong>{client.name}</strong><small>Shared with your team</small></span></button></td><td>{client.company}</td><td>{client.email}</td><td>{client.phone || '—'}</td><td><span className="pv-count">{deals.filter(deal => deal.client === client.id).length}</span></td><td><button className="pv-icon-button" aria-label={`View ${client.name}`} onClick={() => setSelected(client)}><Icon name="arrow" /></button></td></tr>)}</tbody></table>{!filtered.length && <Empty>No matching clients.</Empty>}</div><div className="pv-list-footer">Showing {filtered.length} sample clients <span>All contacts are fictional.</span></div>{selected && <Dialog title="Client details" drawer onClose={() => setSelected(null)}><div className="pv-client-drawer"><Avatar client={selected} /><h2>{selected.name}</h2><p className="muted">{selected.company}</p><div className="pv-detail-section"><h3>Contact information</h3><dl className="pv-detail-fields"><dt>Email</dt><dd>{selected.email}</dd><dt>Phone</dt><dd>{selected.phone || 'Not provided'}</dd></dl></div><div className="pv-detail-section"><h3>Related deals</h3>{deals.filter(deal => deal.client === selected.id).map(deal => <div className="pv-related-deal" key={deal.id}><strong>{deal.title}</strong><Badge status={deal.status} /><p>{money(deal.amount, deal.currency)} · {shortDate(deal.deadline)}</p></div>)}</div><div className="pv-detail-section"><h3>Notes & timeline</h3><p className="muted">Your team’s conversations and context, in one place.</p><div className="pv-sample-note"><div><span className="pv-owner">{profile.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><strong>{profile.name}</strong><time>{content.clientNoteTime}</time></div><p>{content.clientNote}</p></div></div><div className="pv-detail-section"><h3>Links</h3><div className="pv-link-placeholder"><Icon name="file" /><span>{content.linkLabel}<small>Example document · preview only</small></span></div></div><p className="pv-detail-disclaimer">Sample client. Use Clients in the real application to manage saved contacts.</p></div></Dialog>}</section>;
}

function InvoicesPreview({ invoices, clients, workspaceName, profile, content }: { invoices: PreviewInvoice[]; clients: PreviewClient[]; workspaceName: string; profile: PreviewProfile; content: PreviewContent }) {
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<PreviewInvoice | null>(null);
  const filtered = invoices.filter(invoice => filter === 'all' || invoice.status === filter);
  const total = (status: string) => invoices.filter(invoice => invoice.status === status).reduce((sum, invoice) => sum + invoice.amount, 0);
  return <section aria-label="Sample invoices"><div className="pv-invoice-summary">{[['Outstanding', total('sent'), 'blue'], ['Paid', total('paid'), 'green'], ['Drafts', total('draft'), 'gray']].map(([label, value, color]) => <article className="pv-surface" key={label}><span><i className={`pv-stage-dot tone-${color}`} />{label}</span><strong>{money(Number(value))}</strong><small>USD · sample invoices</small></article>)}</div><section className="pv-surface"><div className="pv-toolbar"><div className="pv-segment" role="group" aria-label="Invoice status">{['all', 'draft', 'sent', 'paid'].map(status => <button key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status === 'all' ? 'All invoices' : status[0].toUpperCase() + status.slice(1)}</button>)}</div></div><div className="pv-table-wrap"><table className="pv-table"><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Status</th><th>Amount</th><th>Preview</th></tr></thead><tbody>{filtered.map(invoice => <tr key={invoice.id}><td><button className="pv-text-link" onClick={() => setSelected(invoice)}>{invoice.id}</button><small>{invoice.description}</small></td><td>{clients.find(client => client.id === invoice.client)?.company}</td><td>{new Date(`${invoice.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</td><td><Badge status={invoice.status} /></td><td className="pv-number">{money(invoice.amount)}</td><td><button className="pv-icon-button" aria-label={`Preview ${invoice.id}`} onClick={() => setSelected(invoice)}><Icon name="file" /></button></td></tr>)}</tbody></table>{!filtered.length && <Empty>No invoices in this view.</Empty>}</div><div className="pv-list-footer">{filtered.length} sample invoices <span>Payments and document exports are not connected.</span></div></section>{selected && <Dialog title="Invoice preview" drawer onClose={() => setSelected(null)}><div className="pv-invoice-drawer"><InvoicePaper client={clients.find(client => client.id === selected.client)!} workspaceName={workspaceName} profile={profile} content={content} description={selected.description} quantity={1} price={selected.amount} tax={0} number={selected.id} issueDate={selected.date} /><div className="pv-export-actions"><button className="pv-button secondary" disabled title="PDF generation is not connected in this visual preview">Download PDF</button><button className="pv-button secondary" disabled title="Print will be connected with invoice documents">Print</button></div><p className="pv-detail-disclaimer">Visual document preview only. This is not a saved or issued invoice.</p></div></Dialog>}</section>;
}

function UserAvatar({ profile, large = false }: { profile: PreviewProfile; large?: boolean }) {
  return <span className={`pv-user-avatar ${large ? 'large' : ''}`} aria-label={`${profile.name} avatar`}>{profile.avatar ? <img src={profile.avatar} alt="" /> : profile.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span>;
}

function PreviewThemeSelect({ theme, onChange }: { theme: PreviewTheme; onChange: (theme: PreviewTheme) => void }) {
  return <div className="theme-switch" role="group" aria-label="Preview theme">{(['system', 'light', 'dark'] as const).map(mode => <button key={mode} type="button" className="theme-option" aria-label={`${mode[0].toUpperCase() + mode.slice(1)} theme`} aria-pressed={theme === mode} onClick={() => onChange(mode)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{mode === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></> : mode === 'dark' ? <path d="M20.9 13.3A9 9 0 0 1 10.7 3.1a9 9 0 1 0 10.2 10.2Z" /> : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>}</svg></button>)}</div>;
}

function SettingsPreview({ profile, onProfile, workspaceName, onWorkspaceName, compact, onCompact, reducedMotion, onReducedMotion, defaultCurrency, onDefaultCurrency, theme, onTheme, onSaved }: {
  profile: PreviewProfile;
  onProfile: (profile: PreviewProfile) => void;
  workspaceName: string;
  onWorkspaceName: (name: string) => void;
  compact: boolean;
  onCompact: (value: boolean) => void;
  reducedMotion: boolean;
  onReducedMotion: (value: boolean) => void;
  defaultCurrency: string;
  onDefaultCurrency: (value: string) => void;
  theme: PreviewTheme;
  onTheme: (theme: PreviewTheme) => void;
  onSaved: (message: string) => void;
}) {
  const [tab, setTab] = useState<'Profile' | 'Appearance' | 'Workspace' | 'Preferences' | 'Security'>('Profile');
  const [draft, setDraft] = useState(profile);
  const [workspaceDraft, setWorkspaceDraft] = useState(workspaceName);
  const [avatarError, setAvatarError] = useState('');

  function uploadAvatar(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setAvatarError('Choose a PNG, JPEG or WebP image under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onProfile({ ...profile, avatar: reader.result });
        setAvatarError('');
        onSaved('Preview avatar updated. Changes reset when you reload.');
      }
    };
    reader.onerror = () => setAvatarError('Could not read this image. Try another file.');
    reader.readAsDataURL(file);
  }

  return <div className="pv-settings-layout">
    <nav className="pv-settings-nav" aria-label="Settings sections">{(['Profile', 'Appearance', 'Workspace', 'Preferences', 'Security'] as const).map(item => <button key={item} className={tab === item ? 'active' : ''} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}>{item}</button>)}</nav>
    <section className="pv-surface pv-settings-panel">
      {tab === 'Profile' && <><div className="pv-section-heading"><div><h2>Profile</h2><p>Choose how you appear in this workspace.</p></div><span className="pv-preview-tag">Sample account</span></div><div className="pv-settings-body"><div className="pv-profile-identity"><UserAvatar profile={profile} large /><div><strong>{profile.name}</strong><p>{profile.email}</p></div></div><div className="pv-avatar-actions"><label className="pv-button secondary">Change photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => uploadAvatar(event.target.files?.[0])} /></label>{profile.avatar && <button className="pv-button secondary" onClick={() => { onProfile({ ...profile, avatar: '' }); onSaved('Preview avatar removed. Changes reset when you reload.'); }}>Remove photo</button>}<small>PNG, JPEG or WebP · up to 2 MB</small></div>{avatarError && <p className="pv-field-error" role="alert">{avatarError}</p>}<form onSubmit={event => { event.preventDefault(); onProfile({ ...draft, avatar: profile.avatar, name: draft.name.trim(), username: draft.username.trim(), email: draft.email.trim() }); onSaved('Preview profile updated. Changes reset when you reload.'); }}><div className="pv-settings-fields"><label className="pv-field">Display name<input required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label className="pv-field">Username<input required maxLength={40} value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} /></label><label className="pv-field">Email address<input required type="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label></div><div className="pv-settings-actions"><button className="pv-button primary" type="submit">Save profile</button></div></form></div></>}
      {tab === 'Appearance' && <><div className="pv-section-heading"><div><h2>Appearance</h2><p>Set the tone and spacing of your workspace.</p></div></div><div className="pv-settings-body"><div className="pv-setting-row"><div><strong>Color theme</strong><p>Follow your device, or choose light or dark.</p></div><PreviewThemeSelect theme={theme} onChange={onTheme} /></div><div className="pv-theme-samples" aria-hidden="true"><div className="light"><i /><div><b /><b /><b /></div><span>Light</span></div><div className="dark"><i /><div><b /><b /><b /></div><span>Dark</span></div></div><label className="pv-setting-row"><span><strong>Compact layout</strong><small>Fit more information on the page.</small></span><input type="checkbox" checked={compact} onChange={event => onCompact(event.target.checked)} /></label><label className="pv-setting-row"><span><strong>Reduce motion</strong><small>Limit animation and hover movement.</small></span><input type="checkbox" checked={reducedMotion} onChange={event => onReducedMotion(event.target.checked)} /></label></div></>}
      {tab === 'Workspace' && <><div className="pv-section-heading"><div><h2>Workspace</h2><p>Preview your company identity.</p></div><span className="pv-preview-tag">Sample workspace</span></div><div className="pv-settings-body"><div className="pv-workspace"><span className="pv-workspace-mark">{workspaceName.charAt(0).toUpperCase()}</span><div><strong>{workspaceName}</strong><small>Shared space for your team</small></div></div><form onSubmit={event => { event.preventDefault(); onWorkspaceName(workspaceDraft.trim()); onSaved('Preview workspace updated. Changes reset when you reload.'); }}><label className="pv-field">Workspace name<input required maxLength={80} value={workspaceDraft} onChange={event => setWorkspaceDraft(event.target.value)} /></label><div className="pv-settings-actions"><button className="pv-button primary" type="submit">Save workspace</button></div></form><p className="muted">Clients, deals and invoices belong to this sample workspace in the preview.</p></div></>}
      {tab === 'Preferences' && <><div className="pv-section-heading"><div><h2>Preferences</h2><p>Choose how to explore sample deals.</p></div></div><div className="pv-settings-body"><label className="pv-setting-row"><span><strong>Default deals currency</strong><small>Sets the initial currency filter on the Deals page.</small></span><select aria-label="Default deals currency" value={defaultCurrency} onChange={event => onDefaultCurrency(event.target.value)}><option value="USD">USD</option><option value="EUR">EUR</option></select></label></div></>}
      {tab === 'Security' && <PreviewSecurity />}
    </section>
    <p className="pv-settings-footnote">Preview settings reset when you reload. They do not change your account.</p>
  </div>;
}

function PreviewSecurity() {
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const checks = [
    { label: 'At least 12 characters', valid: passwords.next.length >= 12 },
    { label: 'Uppercase and lowercase letters', valid: /[A-Z]/.test(passwords.next) && /[a-z]/.test(passwords.next) },
    { label: 'At least one number', valid: /\d/.test(passwords.next) },
  ];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setComplete(false);
    if (!checks.every(check => check.valid)) setError('Choose a stronger demo password.');
    else if (passwords.next === passwords.current) setError('Choose a new password different from the current one.');
    else if (passwords.next !== passwords.confirm) setError('The confirmation does not match.');
    else {
      setPasswords({ current: '', next: '', confirm: '' });
      setError('');
      setComplete(true);
    }
  }

  return <><div className="pv-section-heading"><div><h2>Password & security</h2><p>Explore how account protection works.</p></div><span className="pv-preview-tag">Demo only</span></div><div className="pv-settings-body">
    <div className="pv-settings-hint"><strong>Use made-up passwords only</strong><p>This preview does not check your real password or change your account. Nothing from this form is sent to the server.</p></div>
    <form className="pv-security-form" onSubmit={submit} autoComplete="off">
      <h3>Try changing a password</h3>
      <p className="muted">The form demonstrates password checks and clears its fields after a successful trial.</p>
      <label className="pv-field">Current demo password<input type={visible ? 'text' : 'password'} autoComplete="off" required maxLength={128} value={passwords.current} onChange={event => { setPasswords({ ...passwords, current: event.target.value }); setError(''); setComplete(false); }} /></label>
      <label className="pv-field">New demo password<input type={visible ? 'text' : 'password'} autoComplete="off" required maxLength={128} value={passwords.next} onChange={event => { setPasswords({ ...passwords, next: event.target.value }); setError(''); setComplete(false); }} /></label>
      <ul className="pv-password-checks">{checks.map(check => <li key={check.label} className={check.valid ? 'valid' : ''}><Icon name="check" />{check.label}</li>)}</ul>
      <label className="pv-field">Confirm new demo password<input type={visible ? 'text' : 'password'} autoComplete="off" required maxLength={128} value={passwords.confirm} onChange={event => { setPasswords({ ...passwords, confirm: event.target.value }); setError(''); setComplete(false); }} /></label>
      <label className="pv-show-passwords"><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} />Show demo passwords</label>
      {error && <p className="pv-field-error" role="alert">{error}</p>}
      {complete && <p className="pv-security-success" role="status">Demo complete. No account password was changed.</p>}
      <div className="pv-settings-actions"><button className="pv-button primary" type="submit">Try password change</button></div>
    </form>
    <div className="pv-security-facts"><div><strong>Current password required</strong><p>Real password changes verify the existing password.</p></div><div><strong>Other sessions signed out</strong><p>A real password change keeps the current session and invalidates other sessions.</p></div><div><strong>Sign-in method protection</strong><p>The last usable sign-in method cannot be disconnected.</p></div></div>
  </div></>;
}

function InvoicePaper({ client, description, quantity, price, tax, workspaceName, profile, content, issueDate, number = 'DRAFT-PREVIEW' }: { client: PreviewClient; description: string; quantity: number; price: number; tax: number; workspaceName: string; profile: PreviewProfile; content: PreviewContent; issueDate: string; number?: string }) {
  const subtotal = quantity * price;
  return <div className="pv-invoice-paper"><div className="pv-paper-header"><span className="pv-paper-brand">{workspaceName}</span><span>INVOICE</span></div><div className="pv-paper-number"><h3>{number}</h3><span>Draft preview</span></div><div className="pv-paper-parties"><div><span>FROM</span><strong>{workspaceName}</strong><p>{content.invoiceFromDescription}<br />{profile.email}</p></div><div><span>BILL TO</span><strong>{client.company}</strong><p>{client.name}<br />{client.email}</p></div></div><div className="pv-paper-date"><span>Issue date <strong>{new Date(`${issueDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</strong></span><span>Currency <strong>USD</strong></span></div><table><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody><tr><td>{description || 'Your service description'}</td><td>{quantity}</td><td>{money(subtotal)}</td></tr></tbody></table><div className="pv-paper-totals"><p>Subtotal <span>{money(subtotal)}</span></p><p>Tax ({tax}%) <span>{money(subtotal * tax / 100)}</span></p><p className="total">Total <strong>{money(subtotal * (1 + tax / 100))} USD</strong></p></div><div className="pv-paper-thanks">Thank you for creating something great with us.<small>Illustrative document · not issued · no payment requested</small></div></div>;
}

function PreviewEditor({ kind, clients, deal, workspaceName, profile, content, onClose, onClient, onDeal, onInvoice }: { kind: Exclude<Editor, null>; clients: PreviewClient[]; deal: PreviewDeal | null; workspaceName: string; profile: PreviewProfile; content: PreviewContent; onClose: () => void; onClient: (client: PreviewClient) => void; onDeal: (deal: PreviewDeal) => void; onInvoice: (invoice: PreviewInvoice) => void }) {
  const [clientId, setClientId] = useState(deal?.client ?? clients[0].id);
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [tax, setTax] = useState(0);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = `preview-${crypto.randomUUID()}`;
    if (kind === 'client') {
      const name = String(data.get('name')).trim();
      if (!name) return;
      onClient({ id, name, company: String(data.get('company')).trim(), email: String(data.get('email')).trim(), phone: String(data.get('phone')).trim(), initials: name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(), color: 'blue' });
    } else if (kind === 'deal') {
      const title = String(data.get('title')).trim();
      if (!title) return;
      onDeal({ id: deal?.id ?? id, title, client: clientId, amount: Number(data.get('amount')), currency: String(data.get('currency')), status: String(data.get('status')) as Stage, deadline: String(data.get('deadline')) || new Date().toISOString().slice(0, 10), category: deal?.category ?? 'New project' });
    } else onInvoice({ id: `DRAFT-${id.slice(-6).toUpperCase()}`, client: clientId, description, amount: quantity * price * (1 + tax / 100), status: 'draft', date: new Date().toISOString().slice(0, 10) });
  }
  return <Dialog title={`${deal && kind === 'deal' ? 'Edit' : 'New'} ${kind} · preview`} onClose={onClose} drawer={kind === 'invoice'}><form className="pv-editor" onSubmit={submit}><p className="pv-editor-notice">Design preview only. This form does not save to your workspace.</p>{kind === 'client' ? <><label className="pv-field">Name<input name="name" required maxLength={200} placeholder="Client name" autoFocus /></label><label className="pv-field">Company<input name="company" maxLength={200} placeholder="Company or studio" /></label><label className="pv-field">Email<input name="email" type="email" placeholder="Email address" /></label><label className="pv-field">Phone<input name="phone" placeholder="Phone number" /></label></> : <><label className="pv-field">Client<select value={clientId} onChange={event => setClientId(event.target.value)}>{clients.map(client => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}</select></label>{kind === 'deal' ? <><label className="pv-field">Deal title<input name="title" defaultValue={deal?.title} required maxLength={250} placeholder="What are we working on?" autoFocus /></label><div className="pv-form-row"><label className="pv-field">Amount<input name="amount" type="number" min="0" step="0.01" required defaultValue={deal?.amount ?? ''} placeholder="0.00" /></label><label className="pv-field">Currency<select name="currency" defaultValue={deal?.currency ?? 'USD'}><option>USD</option><option>EUR</option></select></label></div><div className="pv-form-row"><label className="pv-field">Stage<select name="status" defaultValue={deal?.status ?? 'new_lead'}>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label><label className="pv-field">Deadline<input name="deadline" type="date" defaultValue={deal?.deadline} /></label></div></> : <><div className="pv-editor-section-title"><h3>Services</h3><span>Invoice layout preview</span></div><label className="pv-field">Description<input value={description} onChange={event => setDescription(event.target.value)} required /></label><div className="pv-form-row"><label className="pv-field">Quantity<input type="number" min="0.001" step="0.001" value={quantity} required onChange={event => setQuantity(Number(event.target.value))} /></label><label className="pv-field">Unit price (USD)<input type="number" min="0" step="0.01" value={price} required onChange={event => setPrice(Number(event.target.value))} /></label><label className="pv-field">Tax (%)<input type="number" min="0" max="100" value={tax} required onChange={event => setTax(Number(event.target.value))} /></label></div><div className="pv-editor-section-title"><h3>Live visual preview</h3></div><InvoicePaper client={clients.find(client => client.id === clientId)!} workspaceName={workspaceName} profile={profile} content={content} description={description} quantity={quantity} price={price} tax={tax} issueDate={new Date().toISOString().slice(0, 10)} /></>}</>}<div className="pv-editor-actions"><button className="pv-button secondary" type="button" onClick={onClose}>Cancel</button><button className="pv-button primary" type="submit">{deal && kind === 'deal' ? 'Update preview' : 'Add to preview'}<Icon name="arrow" /></button></div></form></Dialog>;
}

