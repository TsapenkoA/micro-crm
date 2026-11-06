import { useState } from 'react';
import type { Client } from '../clients/api';
import { date, money, stages, type Deal, type Outcome, type Status } from './api';

const timestamp = (value: string) => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const initials = (value: string) => value.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';

export default function DealDetails({ deal, client, loading, error, busy, outcome, onOutcome, onClose, onReload, onStatus, onEdit, onDelete, onOpenClient }: {
  deal: Deal | null;
  client?: Client;
  loading: boolean;
  error: string;
  busy: boolean;
  outcome: Outcome;
  onOutcome: (value: Outcome) => void;
  onClose: () => void;
  onReload: () => void;
  onStatus: (status: Status, outcome?: Outcome) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenClient: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'notes'>('overview');
  return <aside className="live-deal-detail" aria-label="Deal details" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <div className="live-detail-top"><span className="eyebrow">DEAL DETAILS</span><button className="live-detail-close" aria-label="Close deal details" onClick={onClose} data-deal-close>×</button></div>
    {loading ? <p role="status" className="muted">Loading deal…</p> : error ? <div className="deal-inline-error"><p role="alert">{error}</p><button className="secondary" onClick={onReload}>Reload current</button></div> : deal && <>
      <span className="live-detail-avatar" aria-hidden="true">{initials(client?.company || client?.name || deal.title)}</span>
      <h2>{deal.title}</h2>
      <p className="muted">{client?.company || client?.name || 'Client unavailable'}</p>
      <div className="live-detail-status"><span className={`deal-badge deal-${stages.find(stage => stage.id === deal.status)?.color}`}><i />{stages.find(stage => stage.id === deal.status)?.label}</span><span>Shared deal</span></div>
      <div className="live-detail-tabs" role="group" aria-label="Deal details section"><button aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>Overview</button><button aria-pressed={tab === 'notes'} onClick={() => setTab('notes')}>Notes</button></div>
      {tab === 'overview' ? <>
        <dl className="live-detail-fields"><dt>Deal value</dt><dd className="live-detail-value">{money(deal.amount, deal.currency)}</dd><dt>Client</dt><dd>{client ? <button className="client-name" onClick={onOpenClient}>{client.name}{client.company && <small>{client.company}</small>}</button> : 'Client unavailable'}</dd><dt>Deadline</dt><dd>{date(deal.deadline)}</dd><dt>Created</dt><dd>{timestamp(deal.created_at)}</dd><dt>Updated</dt><dd>{timestamp(deal.updated_at)}</dd>{deal.paid_at && <><dt>Paid at</dt><dd>{timestamp(deal.paid_at)}</dd></>}{deal.status === 'archived' && <><dt>Outcome</dt><dd>{deal.outcome === 'none' ? 'None' : deal.outcome === 'lost' ? 'Lost' : 'Cancelled'}</dd></>}</dl>
        <div className="live-detail-section"><h3>Activity</h3><p className="muted">Created {timestamp(deal.created_at)} · Updated {timestamp(deal.updated_at)}</p></div>
        <label className="field live-detail-stage">Stage<select aria-label="Change status" disabled={busy} value={deal.status} onChange={event => onStatus(event.target.value as Status)}>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
        {deal.status === 'archived' && <div className="live-detail-outcome"><label className="field">Archive outcome<select value={outcome} onChange={event => onOutcome(event.target.value as Outcome)} disabled={busy}><option value="none">None</option><option value="lost">Lost</option><option value="cancelled">Cancelled</option></select></label><button className="secondary" disabled={busy || outcome === deal.outcome} onClick={() => onStatus('archived', outcome)}>Save outcome</button></div>}
      </> : <div className="live-detail-section live-detail-notes"><h3>Client notes</h3><p className="muted">Notes are saved on the client record and shared with your company.</p>{client ? <button className="secondary" onClick={onOpenClient}>Open client notes</button> : <p className="muted">Client unavailable.</p>}</div>}
      <div className="live-detail-actions"><button className="secondary" disabled={busy} onClick={onEdit}>Edit deal <span aria-hidden="true">↗</span></button><button className="text-action danger" disabled={busy} onClick={onDelete}>Delete deal</button></div>
      <p className="live-detail-footnote">Version {deal.version} · Paid is a pipeline stage. Invoice revenue is tracked separately.</p>
    </>}
  </aside>;
}
