import { useEffect, useState } from 'react';
import { clients, type ClientDetail } from './api';

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
    <div><p className="eyebrow">SHARED CLIENT</p><h3>{client.name}</h3><p className="muted">{client.company || 'No company provided'}</p></div>
    <div className="button-row"><button className="secondary" onClick={() => onEdit(client)}>Edit client</button>
      <button className="secondary danger" onClick={() => onDelete(client)}>Delete client</button></div>
    <section><h3>Contact information</h3><dl className="contact-list">
      <dt>Email</dt><dd>{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : 'Not provided'}</dd>
      <dt>Phone</dt><dd>{client.phone ? <a href={`tel:${client.phone}`}>{client.phone}</a> : 'Not provided'}</dd>
    </dl></section>
    <section><h3>Deals ({client.deals.length})</h3>{client.deals.length ? <ul className="deal-list">
      {client.deals.map(deal => <li key={deal.id}><strong>{deal.title}</strong><p className="muted">{deal.status.replaceAll('_', ' ')} · {deal.amount} {deal.currency}</p>
        <p className="muted">{deal.deadline ? `Due ${new Date(deal.deadline).toLocaleDateString()}` : 'No deadline'}</p></li>)}
    </ul> : <p className="muted">No related deals.</p>}</section>
    <section><h3>Notes</h3><p className="muted">Notes will be available here.</p></section>
    <section><h3>Links</h3><p className="muted">Links will be available here.</p></section>
  </div>;
}
