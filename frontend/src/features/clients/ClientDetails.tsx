import { Fragment, useEffect, useState } from 'react';
import { clients, type ClientDetail } from './api';
import ClientHistory from './ClientHistory';
import ClientInvoices from './ClientInvoices';
import ClientContacts from './ClientContacts';
import ClientAttachments from './ClientAttachments';
import RelatedTasks from '../tasks/RelatedTasks';
import ClientOverview, { useClientPreview } from './ClientOverview';
import ClientSectionIcon from './ClientSectionIcon';
import { date, money, stages } from '../deals/api';
import { bankFields } from '../../components/BankDetailsFields';

const initials = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
const timestamp = (value: string) =>
  new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
type Tab = 'overview' | 'contacts' | 'deals' | 'tasks' | 'invoices' | 'notes' | 'links' | 'files';
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'deals', label: 'Deals' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'notes', label: 'Notes' },
  { id: 'links', label: 'Links' },
  { id: 'files', label: 'Files' },
];

export default function ClientDetails({
  id,
  onEdit,
  onDelete,
}: {
  id: string;
  onEdit: (client: ClientDetail) => void;
  onDelete: (client: ClientDetail) => void;
}) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [previewRevision, setPreviewRevision] = useState(0);
  const refreshPreview = () => setPreviewRevision((value) => value + 1);
  const { preview, failed } = useClientPreview(id, previewRevision);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    clients
      .detail(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setClient(data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load the client.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, revision]);

  if (loading)
    return (
      <p role="status" className="dialog-body muted">
        Loading client…
      </p>
    );
  if (error)
    return (
      <div className="dialog-body">
        <p role="alert" className="notice error">
          {error}
        </p>
        <button className="secondary" onClick={() => setRevision((value) => value + 1)}>
          Retry
        </button>
      </div>
    );
  if (!client) return null;

  const relatedDeals = (
    <section aria-label="Client deals">
      <div className="history-heading">
        <h3>
          Deals <span className="client-deal-count">{client.deals.length}</span>
        </h3>
        <a className="text-action" href="#/deals">
          View all deals →
        </a>
      </div>
      {client.deals.length ? (
        <ul className="deal-list">
          {client.deals.map((deal) => {
            const stage = stages.find((item) => item.id === deal.status);
            return (
              <li key={deal.id} className="client-related-deal">
                <a href={`#/deals?deal=${encodeURIComponent(deal.id)}`}>{deal.title}</a>
                <span className={`deal-badge deal-${stage?.color ?? 'gray'}`}>
                  <i />
                  {stage?.label ?? deal.status.replaceAll('_', ' ')}
                </span>
                <p className="muted">
                  {money(deal.amount, deal.currency)} · {deal.deadline ? `Due ${date(deal.deadline)}` : 'No deadline'}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No related deals.</p>
      )}
    </section>
  );
  const relatedContacts = (
    <ClientContacts
      clientId={client.id}
      onPrimaryChanged={() => {
        setRevision((value) => value + 1);
        refreshPreview();
      }}
    />
  );

  return (
    <div className="client-details">
      <aside className="client-detail-profile">
        <div className="client-detail-identity">
          <span className="client-detail-avatar" aria-hidden="true">
            {initials(client.company || client.name)}
          </span>
          <div>
            <h3>{client.name}</h3>
            <p className="muted">{client.company || 'No company provided'}</p>
          </div>
        </div>
        <div className="button-row client-detail-actions">
          <button className="secondary" onClick={() => onEdit(client)}>
            <ClientSectionIcon name="edit" />
            Edit client
          </button>
          <button className="secondary danger" onClick={() => onDelete(client)}>
            <ClientSectionIcon name="delete" />
            Delete client
          </button>
        </div>
        <div className="client-detail-contact">
          <div>
            <ClientSectionIcon name="email" />
            <span>
              <small>Email</small>
              {client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : 'Not provided'}
            </span>
          </div>
          <div>
            <ClientSectionIcon name="phone" />
            <span>
              <small>Phone</small>
              {client.phone ? <a href={`tel:${client.phone}`}>{client.phone}</a> : 'Not provided'}
            </span>
          </div>
        </div>
        <dl className="contact-list client-detail-dates">
          <dt>
            <ClientSectionIcon name="calendar" />
            Created
          </dt>
          <dd>{timestamp(client.created_at)}</dd>
          <dt>
            <ClientSectionIcon name="calendar" />
            Updated
          </dt>
          <dd>{timestamp(client.updated_at)}</dd>
        </dl>
        <details className="client-detail-bank">
          <summary>
            <ClientSectionIcon name="bank" />
            Payer bank details
          </summary>
          {bankFields.some(([field]) => client.bank_details?.[field]) ? (
            <dl className="contact-list">
              {bankFields
                .filter(([field]) => client.bank_details?.[field])
                .map(([field, label]) => (
                  <Fragment key={field}>
                    <dt>{label}</dt>
                    <dd>{client.bank_details?.[field]}</dd>
                  </Fragment>
                ))}
            </dl>
          ) : (
            <p className="muted">No bank details saved for this client.</p>
          )}
        </details>
      </aside>
      <div className="client-detail-main">
        <nav className="client-detail-tabs" aria-label="Client sections">
          {tabs.map((item) => {
            const count =
              item.id === 'deals'
                ? client.deals.length
                : item.id === 'contacts'
                  ? client.contacts.length
                  : item.id === 'overview'
                    ? undefined
                    : preview[item.id]?.count;
            return (
              <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}>
                <ClientSectionIcon name={item.id} />
                {item.label}
                {count !== undefined && (
                  <>
                    {' '}
                    <span className="client-deal-count">{count}</span>
                  </>
                )}
              </button>
            );
          })}
        </nav>
        <div className="client-detail-content">
          {tab === 'overview' && <ClientOverview client={client} preview={preview} failed={failed} onSelect={setTab} />}
          {tab === 'contacts' && <div className="client-detail-card">{relatedContacts}</div>}
          {tab === 'deals' && <div className="client-detail-card">{relatedDeals}</div>}
          {tab === 'tasks' && (
            <div className="client-detail-card">
              <RelatedTasks clientId={client.id} onChanged={refreshPreview} />
            </div>
          )}
          {tab === 'invoices' && (
            <div className="client-detail-card">
              <ClientInvoices clientId={client.id} />
            </div>
          )}
          {tab === 'notes' && (
            <div className="client-detail-card">
              <ClientHistory clientId={client.id} kind="notes" onChanged={refreshPreview} collapsibleForm />
            </div>
          )}
          {tab === 'links' && (
            <div className="client-detail-card">
              <ClientHistory clientId={client.id} kind="links" onChanged={refreshPreview} collapsibleForm />
            </div>
          )}
          {tab === 'files' && (
            <div className="client-detail-card">
              <ClientAttachments clientId={client.id} onChanged={refreshPreview} collapsibleForm />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
