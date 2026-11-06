import { useEffect, useState } from 'react';
import { clients, type ClientDetail } from './api';
import ClientHistory from './ClientHistory';
import { date, money, stages } from '../deals/api';

const initials = (value: string) => value.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
const timestamp = (value: string) => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export default function ClientDetails({ id, onEdit, onDelete }: {
  id: string;
  onEdit: (client: ClientDetail) => void;
  onDelete: (client: ClientDetail) => void;
}) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    clients.detail(id, controller.signal).then(data => { if (!controller.signal.aborted) setClient(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load the client.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);

  if (loading) return <p role="status" className="dialog-body muted">Loading client…</p>;
  if (error) return <div className="dialog-body"><p role="alert" className="notice error">{error}</p>
    <button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry</button></div>;
  if (!client) return null;

  return <div className="dialog-body client-details">
    <div className="client-detail-identity"><span className="client-detail-avatar" aria-hidden="true">{initials(client.company || client.name)}</span><h3>{client.name}</h3><p className="muted">{client.company || 'No company provided'}</p></div>
    <div className="button-row client-detail-actions"><button className="secondary" onClick={() => onEdit(client)}>Edit client</button>
      <button className="secondary danger" onClick={() => onDelete(client)}>Delete client</button></div>
    <section><h3>Contact information</h3><dl className="contact-list">
      <dt>Email</dt><dd>{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : 'Not provided'}</dd>
      <dt>Phone</dt><dd>{client.phone ? <a href={`tel:${client.phone}`}>{client.phone}</a> : 'Not provided'}</dd>
      <dt>Created</dt><dd>{timestamp(client.created_at)}</dd>
      <dt>Updated</dt><dd>{timestamp(client.updated_at)}</dd>
    </dl></section>
    <section><h3>Related deals <span className="client-deal-count">{client.deals.length}</span></h3>{client.deals.length ? <ul className="deal-list">
      {client.deals.map(deal => { const stage = stages.find(item => item.id === deal.status); return <li key={deal.id} className="client-related-deal"><a href={`#/deals?deal=${encodeURIComponent(deal.id)}`}>{deal.title}</a><span className={`deal-badge deal-${stage?.color ?? 'gray'}`}><i />{stage?.label ?? deal.status.replaceAll('_', ' ')}</span><p className="muted">{money(deal.amount, deal.currency)} · {deal.deadline ? `Due ${date(deal.deadline)}` : 'No deadline'}</p></li>; })}
    </ul> : <p className="muted">No related deals.</p>}</section>
    <ClientHistory clientId={client.id} />
  </div>;
}
