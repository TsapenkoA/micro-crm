import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import Dialog from '../../components/Dialog';
import type { Client } from '../clients/api';
import DealForm from './DealForm';
import DealDetails from './DealDetails';
import { date, deals, errorMessage, money, stages, type Deal, type Outcome, type Status, type Total } from './api';
import './deals.css';

const linkedDeal = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('deal');

function Badge({ status }: { status: Status }) {
  const stage = stages.find(item => item.id === status)!;
  return <span className={`deal-badge deal-${stage.color}`}><i />{stage.label}</span>;
}

function Card({ deal, client, onOpen, disabled }: { deal: Deal; client?: Client; onOpen: (trigger: HTMLButtonElement) => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: deal.id, disabled });
  return <article ref={setNodeRef} className={`live-deal-card ${isDragging ? 'is-dragging' : ''}`}>
    <div className="deal-card-top"><span className="deal-client-mark" aria-hidden="true">{(client?.company || client?.name || '?').slice(0, 2).toUpperCase()}</span><button ref={setActivatorNodeRef} {...attributes} {...listeners} className="deal-drag-handle" disabled={disabled} aria-label={`Drag ${deal.title} to another status`}>⠿</button></div>
    <button className="deal-open-card" aria-label={`Open ${deal.title}`} onClick={event => onOpen(event.currentTarget)}><strong>{deal.title}</strong><span>{client?.name ?? 'Client unavailable'}</span>{client?.company && <small>{client.company}</small>}</button><strong className="deal-money">{money(deal.amount, deal.currency)}</strong><div className="deal-card-footer"><span>{date(deal.deadline)}</span><Badge status={deal.status} /></div>
  </article>;
}

function Column({ status, deals: records, totals, clients, onOpen, busy }: { status: Status; deals: Deal[]; totals: Total[]; clients: Map<string, Client>; onOpen: (id: string, trigger: HTMLButtonElement) => void; busy: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: busy });
  const stage = stages.find(item => item.id === status)!;
  return <section ref={setNodeRef} aria-label={stage.label} className={`live-deal-column deal-${stage.color} ${isOver ? 'drop-over' : ''}`}><header><div><i className="deal-stage-dot" /><h2>{stage.label}</h2><span className="deal-count">{records.length}</span></div><div className="deal-column-totals">{busy ? <span>Updating…</span> : totals.length ? totals.map(total => <span key={total.currency}>{money(total.amount, total.currency)}</span>) : <span>No value yet</span>}</div></header><div className="deal-card-stack">{records.map(deal => <Card key={deal.id} deal={deal} client={clients.get(deal.client)} onOpen={trigger => onOpen(deal.id, trigger)} disabled={busy} />)}{!records.length && <p className="deal-column-empty">No deals in this stage.<br />Move an opportunity here when it’s ready.</p>}</div></section>;
}

export default function DealsPage({ createRequested = false, onCreateHandled, onCountChanged, showCreate = true }: { createRequested?: boolean; onCreateHandled?: () => void; onCountChanged?: () => void; showCreate?: boolean }) {
  const [records, setRecords] = useState<Deal[]>([]);
  const [totals, setTotals] = useState<Total[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [currency, setCurrency] = useState('');
  const [view, setView] = useState('board');
  const [sort, setSort] = useState('newest');
  const [tablePage, setTablePage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(linkedDeal);
  const [detail, setDetail] = useState<Deal | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [editor, setEditor] = useState<{ deal?: Deal } | null>(null);
  const [deleting, setDeleting] = useState<Deal | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [saving, setSaving] = useState(false);
  const [mutation, setMutation] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('none');
  const mutationRef = useRef(false);
  const mounted = useRef(true);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor));
  const clientMap = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (selected && loaded) document.querySelector<HTMLButtonElement>('[data-deal-close]')?.focus(); }, [selected, loaded]);
  useEffect(() => { if (createRequested) { setEditor({}); onCreateHandled?.(); } }, [createRequested, onCreateHandled]);
  useEffect(() => {
    const changed = () => { const id = linkedDeal(); if (id) setSelected(id); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.all([deals.list({ search, status, currency }, controller.signal), deals.clients(controller.signal)])
      .then(([result, clients]) => {
        if (controller.signal.aborted) return;
        setRecords(result.results); setTotals(result.totals); setClients(clients); setLoaded(true);
        setCurrencies(current => [...new Set([...current, ...result.totals.map(total => total.currency)])].sort());
        setTablePage(1);
      }).catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, status, currency, revision]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const controller = new AbortController();
    setDetail(null); setDetailLoading(true); setDetailError('');
    deals.detail(selected, controller.signal).then(result => { if (!controller.signal.aborted) { setDetail(result); setOutcome(result.outcome); } })
      .catch(cause => { if (!controller.signal.aborted) setDetailError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selected, revision]);

  function refresh() { setRevision(value => value + 1); }
  function searchSubmit(event: FormEvent) { event.preventDefault(); setSearch(draft.trim()); setTablePage(1); refresh(); }
  function openDetail(id: string, trigger: HTMLButtonElement) { detailTrigger.current = trigger; setSelected(id); }
  function closeDetail() { setSelected(null); if (linkedDeal()) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/deals`); if (detailTrigger.current?.isConnected) detailTrigger.current.focus(); }
  function saved(deal: Deal) { setEditor(null); setSelected(deal.id); setMessage('Deal saved.'); refresh(); onCountChanged?.(); }
  async function changeStatus(deal: Deal, next: Status, archivedOutcome: Outcome = 'none') {
    if (mutationRef.current || saving) return;
    mutationRef.current = true; setMutation(true); setMessage(''); setMutationError('');
    const previous = records;
    setRecords(current => current.map(item => item.id === deal.id ? { ...item, status: next, outcome: next === 'archived' ? archivedOutcome : 'none' } : item));
    try { await deals.status(deal, next, archivedOutcome); if (mounted.current) setMessage('Deal status updated.'); }
    catch (cause) { if (mounted.current) { setRecords(previous); setMutationError(errorMessage(cause)); } }
    finally { mutationRef.current = false; if (mounted.current) { setMutation(false); refresh(); } }
  }
  function dragEnd(event: DragEndEvent) {
    setDragged(null);
    const next = stages.find(stage => stage.id === event.over?.id)?.id;
    const deal = records.find(item => item.id === event.active.id);
    if (deal && next && deal.status !== next) void changeStatus(deal, next);
  }
  async function remove() {
    if (!deleting || mutationRef.current) return;
    mutationRef.current = true; setMutation(true); setDeleteError('');
    try { await deals.remove(deleting); if (mounted.current) { if (selected === deleting.id) closeDetail(); setDeleting(null); setMessage('Deal deleted.'); refresh(); onCountChanged?.(); } }
    catch (cause) { if (mounted.current) setDeleteError(errorMessage(cause)); }
    finally { mutationRef.current = false; if (mounted.current) setMutation(false); }
  }
  const sorted = [...records].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    if (sort === 'client') return (clientMap.get(a.client)?.name ?? '').localeCompare(clientMap.get(b.client)?.name ?? '') || a.id.localeCompare(b.id);
    if (sort === 'deadline') return (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.id.localeCompare(b.id);
    return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
  });
  const tableRecords = sorted.slice((tablePage - 1) * 20, tablePage * 20);
  const companyClient = detail && clientMap.get(detail.client);
  const pipeline = new Map<string, bigint>();
  for (const total of totals) {
    if (!['new_lead', 'negotiation', 'in_progress'].includes(total.status)) continue;
    const [whole, fraction = ''] = total.amount.split('.');
    pipeline.set(total.currency, (pipeline.get(total.currency) ?? 0n) + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
  }
  const pipelineAmounts = [...pipeline].sort(([a], [b]) => a.localeCompare(b)).map(([code, cents]) => money(`${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`, code));

  return <section className="live-deals" aria-label="Company deals">
    <div className="deal-toolbar"><div className="deal-view-switch" role="group" aria-label="Deal view"><button aria-pressed={view === 'board'} onClick={() => setView('board')}>▥ Kanban</button><button aria-pressed={view === 'table'} onClick={() => setView('table')}>☷ Table</button></div><form role="search" onSubmit={searchSubmit} className="deal-search"><input aria-label="Search deals" placeholder="Search deals or clients…" value={draft} onChange={event => setDraft(event.target.value)} /><button className="secondary">Search</button>{(search || draft) && <button className="secondary" type="button" onClick={() => { setDraft(''); setSearch(''); refresh(); }}>Clear</button>}</form><select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select><select aria-label="Filter by currency" value={currency} onChange={event => setCurrency(event.target.value)}><option value="">All currencies</option>{[...new Set([...currencies, currency].filter(Boolean))].map(value => <option key={value}>{value}</option>)}</select><button className="secondary" onClick={refresh} disabled={loading || mutation}>Refresh</button>{showCreate && <button className="primary" onClick={() => setEditor({})}>+ New deal</button>}</div>
    <div className="deal-list-caption"><span><strong>{records.length}</strong> {records.length === 1 ? 'deal' : 'deals'} <span className="deal-caption-divider">/</span> Keep the next step in sight.</span><span className="deal-pipeline-total">Active pipeline <strong>{pipelineAmounts.length ? pipelineAmounts.join(' · ') : currency ? money('0.00', currency) : 'No active deals'}</strong></span></div>
    {message && <p className="notice success" role="status">{message}</p>}
    {mutationError && <div className="deal-inline-error"><p role="alert">{mutationError}</p><button className="secondary" onClick={() => { setMutationError(''); refresh(); }}>Reload current</button></div>}
    {error && <div className="deal-inline-error"><p role="alert">{error}</p><button className="secondary" onClick={refresh}>Reload current</button></div>}
    {loading && <p role="status" className="muted deal-loading">{loaded ? 'Refreshing deals…' : 'Loading deals…'}</p>}
    {loaded && <>
      {!error && !records.length && <div className="empty-state panel"><div className="empty-icon" aria-hidden="true">◇</div><h2>{search || status || currency ? 'No matching deals' : 'No deals yet'}</h2><p className="muted">{search || status || currency ? 'Try another search or clear your filters.' : 'Create your first opportunity and keep the next step in sight.'}</p><button className="primary" onClick={() => setEditor({})}>Create a deal</button></div>}
      <div className={`live-deal-layout ${selected ? 'with-detail' : ''}`}>
        <div className="live-deal-content">
      {view === 'board' ? <DndContext sensors={sensors} onDragStart={event => setDragged(String(event.active.id))} onDragCancel={() => setDragged(null)} onDragEnd={dragEnd}><div className="live-deal-board">{stages.map(stage => <Column key={stage.id} status={stage.id} deals={records.filter(deal => deal.status === stage.id)} totals={totals.filter(total => total.status === stage.id)} clients={clientMap} onOpen={openDetail} busy={mutation} />)}</div><DragOverlay>{dragged && <div className="deal-drag-overlay">{records.find(deal => deal.id === dragged)?.title}</div>}</DragOverlay></DndContext> : <section className="panel deal-table-panel"><div className="deal-table-controls"><label>Sort by <select value={sort} onChange={event => { setSort(event.target.value); setTablePage(1); }}><option value="newest">Newest first</option><option value="title">Title</option><option value="client">Client</option><option value="deadline">Deadline</option></select></label></div><div className="deal-table-scroll"><table className="live-deal-table"><caption className="sr-only">Deals in your company workspace</caption><thead><tr><th>Deal</th><th>Client</th><th>Status</th><th>Amount / currency</th><th>Deadline</th><th>Actions</th></tr></thead><tbody>{tableRecords.map(deal => <tr key={deal.id}><th scope="row"><button className="client-name" onClick={event => openDetail(deal.id, event.currentTarget)}>{deal.title}</button></th><td>{clientMap.get(deal.client)?.name ?? 'Client unavailable'}</td><td><Badge status={deal.status} /></td><td>{money(deal.amount, deal.currency)}</td><td>{date(deal.deadline)}</td><td><div className="button-row"><button className="text-action" aria-label={`Edit ${deal.title}`} onClick={() => setEditor({ deal })}>Edit</button><button className="text-action danger" aria-label={`Delete ${deal.title}`} onClick={() => { setDeleteError(''); setDeleting(deal); }}>Delete</button></div></td></tr>)}</tbody></table></div><footer className="pagination"><span>{records.length} deals · Page {tablePage}</span><div className="button-row"><button className="secondary" disabled={tablePage === 1} onClick={() => setTablePage(value => value - 1)}>Previous</button><button className="secondary" disabled={tablePage * 20 >= records.length} onClick={() => setTablePage(value => value + 1)}>Next</button></div></footer></section>}
        </div>
        {selected && <DealDetails key={selected} deal={detail} client={companyClient ?? undefined} loading={detailLoading} error={detailError} busy={mutation || loading} outcome={outcome} onOutcome={setOutcome} onClose={closeDetail} onReload={refresh} onStatus={(next, nextOutcome = 'none') => { if (detail) void changeStatus(detail, next, nextOutcome); }} onEdit={() => { if (detail) setEditor({ deal: detail }); }} onDelete={() => { if (detail) { setDeleteError(''); setDeleting(detail); } }} onOpenClient={() => { if (companyClient) { closeDetail(); window.location.hash = `/clients?client=${encodeURIComponent(companyClient.id)}`; } }} />}
      </div>
      <p className="deal-board-help">Drag a card’s handle to change its stage, or open the card and use Change status. Moving to Archived sets outcome to None; choose Lost or Cancelled in details.</p>
    </>}
    {editor && <Dialog title={editor.deal ? 'Edit deal' : 'New deal'} className="deal-editor-dialog" onClose={() => setEditor(null)} busy={saving}>{!loaded || loading && !clients.length ? <div className="dialog-body"><p role="status">Loading company clients…</p>{error && <><p role="alert">{error}</p><button className="secondary" onClick={refresh}>Retry</button></>}</div> : <DealForm initial={editor.deal} clients={clients} onCancel={() => setEditor(null)} onSaved={saved} onPending={setSaving} />}</Dialog>}
    {deleting && <Dialog title="Delete deal" role="alertdialog" busy={mutation} onClose={() => setDeleting(null)}><div className="dialog-body"><p>Delete “{deleting.title}”? This action cannot be undone. The client and its history will be preserved.</p>{deleteError && <><p className="notice error" role="alert">{deleteError}</p><button className="secondary" disabled={mutation} onClick={async () => { try { setDeleting(await deals.detail(deleting.id)); setDeleteError('Latest version loaded. Review the deal before confirming deletion again.'); refresh(); } catch (cause) { setDeleteError(errorMessage(cause)); } }}>Reload current</button></>}<div className="dialog-actions"><button className="secondary" disabled={mutation} onClick={() => setDeleting(null)}>Cancel</button><button className="primary destructive" disabled={mutation} onClick={() => void remove()}>{mutation ? 'Deleting…' : 'Confirm deletion'}</button></div></div></Dialog>}
  </section>;
}
