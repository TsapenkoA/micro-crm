import InvoiceStatus from '../invoices/InvoiceStatus';
import { ApiError } from '../../api/client';
import { useEffect, useState, type FormEvent } from 'react';
import { clients, type Client, type ClientNote, type HistoryPage } from '../clients/api';
import { activity, type ActivityEvent } from '../activity/api';
import { invoices, money as invoiceMoney, type InvoiceListItem } from '../invoices/api';
import { tasks } from '../tasks/api';
import { date, deals, isOverdue, money, stages, type Deal, type Outcome, type Status } from './api';
import RelatedTasks from '../tasks/RelatedTasks';
import ClientSectionIcon from '../clients/ClientSectionIcon';

const timestamp = (value: string) =>
  new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const initials = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
type Tab = 'overview' | 'tasks' | 'invoices' | 'notes';
const factPaths = {
  value: 'm12 3 9 5-9 5-9-5 9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5',
  deadline: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4',
  created: 'M12 3a9 9 0 1 0 9 9 M12 7v5l3 2',
  updated: 'M3 12a9 9 0 1 0 3-6 M3 3v5h5 M12 7v5l3 2',
} as const;
function FactIcon({ name }: { name: keyof typeof factPaths }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={factPaths[name]} />
    </svg>
  );
}

export default function DealDetails({
  deal,
  client,
  loading,
  error,
  mutationError,
  busy,
  outcome,
  onOutcome,
  onReload,
  onStatus,
  onEdit,
  onDelete,
  onOpenClient,
}: {
  deal: Deal | null;
  client?: Client;
  loading: boolean;
  error: string;
  mutationError?: string;
  busy: boolean;
  outcome: Outcome;
  onOutcome: (value: Outcome) => void;
  onReload: () => void;
  onStatus: (status: Status, outcome?: Outcome) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenClient: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [linkedInvoices, setLinkedInvoices] = useState<InvoiceListItem[]>([]);
  const [invoiceError, setInvoiceError] = useState('');
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [relatedTasks, setRelatedTasks] = useState<number | null>(null);
  const [notes, setNotes] = useState<HistoryPage<ClientNote> | null>(null);
  const [noteError, setNoteError] = useState('');
  const [notePage, setNotePage] = useState(1);
  const [noteRevision, setNoteRevision] = useState(0);
  const [notesLoading, setNotesLoading] = useState(true);
  const [noteMessage, setNoteMessage] = useState('');
  const [activityError, setActivityError] = useState('');
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const dealId = deal?.id;
  useEffect(() => {
    if (!dealId) return;
    const controller = new AbortController();
    setInvoicesLoading(true);
    setInvoiceError('');
    invoices
      .list('', '', controller.signal, dealId)
      .then((rows) => {
        if (!controller.signal.aborted) setLinkedInvoices(rows);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setInvoiceError(cause instanceof Error ? cause.message : 'Unable to load linked invoices.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setInvoicesLoading(false);
      });
    return () => controller.abort();
  }, [dealId]);
  useEffect(() => {
    if (!dealId) return;
    const controller = new AbortController();
    setRelatedTasks(null);
    setEvents([]);
    setActivityError('');
    tasks
      .list({ deal: dealId, page_size: 1 }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRelatedTasks(result.count);
      })
      .catch(() => {});
    activity
      .list(1, 'deal', controller.signal, '', '', '', dealId)
      .then((result) => {
        if (!controller.signal.aborted) setEvents(result.results.slice(0, 3));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [dealId]);

  useEffect(() => {
    if (!dealId) return;
    const controller = new AbortController();
    setNotesLoading(true);
    setNoteError('');
    deals
      .notes(dealId, notePage, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setNotes(result);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 404 && notePage > 1) setNotePage((value) => value - 1);
        else setNoteError('Unable to load deal notes. Retry to refresh the list.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setNotesLoading(false);
      });
    return () => controller.abort();
  }, [dealId, notePage, noteRevision]);

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!deal || !draft.trim() || posting) return;
    setPosting(true);
    setNoteError('');
    setNoteMessage('');
    try {
      await deals.addNote(deal.id, draft.trim());
    } catch (cause) {
      setNoteError(cause instanceof Error ? cause.message : 'Unable to save the note.');
      return;
    } finally {
      setPosting(false);
    }
    setDraft('');
    setNoteMessage('Note added.');
    setNotePage(1);
    setNoteRevision((value) => value + 1);
    activity
      .list(1, 'deal', undefined, '', '', '', deal.id)
      .then((result) => {
        setEvents(result.results.slice(0, 3));
        setActivityError('');
      })
      .catch(() => setActivityError('Note saved. Activity could not be refreshed.'));
  }

  async function removeNote(note: ClientNote) {
    if (!deal || posting) return;
    setPosting(true);
    setNoteError('');
    setNoteMessage('');
    try {
      await clients.removeNote(deal.client, note.id);
      setNoteMessage('Note deleted.');
      setNoteRevision((value) => value + 1);
    } catch (cause) {
      setNoteError(cause instanceof Error ? cause.message : 'Unable to delete the note.');
    } finally {
      setPosting(false);
    }
  }

  if (loading)
    return (
      <p role="status" className="dialog-body muted">
        Loading deal…
      </p>
    );
  if (error)
    return (
      <div className="dialog-body deal-inline-error">
        <p role="alert">{error}</p>
        <button className="secondary" onClick={onReload}>
          Reload current
        </button>
      </div>
    );
  if (!deal) return null;
  const stage = stages.find((item) => item.id === deal.status);

  return (
    <div className="live-deal-detail">
      <div className="live-detail-summary">
        <span className="live-detail-avatar" aria-hidden="true">
          {initials(client?.company || client?.name || deal.title)}
        </span>
        <div className="live-detail-identity">
          <h3>{deal.title}</h3>
          {client ? (
            <button className="client-name" onClick={onOpenClient}>
              {client.company || client.name}
            </button>
          ) : (
            <span className="muted">Client unavailable</span>
          )}
        </div>
        <div className="live-detail-controls">
          <span className={`deal-badge deal-${stage?.color ?? 'gray'}`}>
            <i />
            {stage?.label ?? deal.status}
          </span>
          <button className="secondary" disabled={busy} onClick={onEdit}>
            <ClientSectionIcon name="edit" />
            Edit deal
          </button>
          <button className="secondary danger" disabled={busy} onClick={onDelete}>
            <ClientSectionIcon name="delete" />
            Delete deal
          </button>
        </div>
      </div>
      <div className="live-detail-facts">
        <div>
          <FactIcon name="value" />
          <span>
            <small>Deal value</small>
            <strong>{money(deal.amount, deal.currency)}</strong>
          </span>
        </div>
        <div>
          <ClientSectionIcon name="contacts" />
          <span>
            <small>Client</small>
            <button className="live-detail-client-link" onClick={onOpenClient} disabled={!client}>
              {client?.name ?? 'Client unavailable'}
            </button>
            {client?.company && <span className="muted">{client.company}</span>}
          </span>
        </div>
        <div>
          <FactIcon name="deadline" />
          <span>
            <small>Deadline</small>
            <span className={isOverdue(deal) ? 'is-overdue' : ''}>{date(deal.deadline)}</span>
          </span>
        </div>
        <div>
          <FactIcon name="created" />
          <span>
            <small>Created</small>
            {timestamp(deal.created_at)}
          </span>
        </div>
        <div>
          <FactIcon name="updated" />
          <span>
            <small>Updated</small>
            {timestamp(deal.updated_at)}
          </span>
        </div>
      </div>
      <div className="live-detail-tabs" role="group" aria-label="Deal details section">
        {(['overview', 'tasks', 'invoices', 'notes'] as Tab[]).map((section) => (
          <button key={section} aria-pressed={tab === section} onClick={() => setTab(section)}>
            <ClientSectionIcon name={section === 'overview' ? 'overview' : section} />
            {section[0].toUpperCase() + section.slice(1)}
            {section === 'tasks' && relatedTasks !== null && <span className="client-deal-count">{relatedTasks}</span>}
            {section === 'invoices' && !invoicesLoading && !invoiceError && (
              <span className="client-deal-count">{linkedInvoices.length}</span>
            )}
            {section === 'notes' && notes && <span className="client-deal-count">{notes.count}</span>}
          </button>
        ))}
      </div>
      <div className="live-detail-body">
        {mutationError && (
          <div className="deal-inline-error">
            <p role="alert">{mutationError}</p>
            <button className="secondary" onClick={onReload} disabled={busy}>
              Reload current
            </button>
          </div>
        )}
        {tab === 'overview' && (
          <div className="live-detail-overview">
            <section className="live-detail-card">
              <div className="history-heading">
                <h4>Description</h4>
                <button
                  className="text-action"
                  aria-label="Edit description"
                  title="Edit description"
                  disabled={busy}
                  onClick={onEdit}
                >
                  <ClientSectionIcon name="edit" />
                </button>
              </div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{deal.description || 'No description yet.'}</p>
              <label className="field live-detail-stage">
                Stage
                <select
                  aria-label="Change status"
                  disabled={busy}
                  value={deal.status}
                  onChange={(event) => onStatus(event.target.value as Status)}
                >
                  {stages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {deal.status === 'archived' && (
                <div className="live-detail-outcome">
                  <label className="field">
                    Archive outcome
                    <select
                      value={outcome}
                      onChange={(event) => onOutcome(event.target.value as Outcome)}
                      disabled={busy}
                    >
                      <option value="none">None</option>
                      <option value="lost">Lost</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                  <button
                    className="secondary"
                    disabled={busy || outcome === deal.outcome}
                    onClick={() => onStatus('archived', outcome)}
                  >
                    Save outcome
                  </button>
                </div>
              )}
            </section>
            <section className="live-detail-card">
              <h4>Activity</h4>
              <ul className="live-detail-events">
                <li>
                  <FactIcon name="updated" />
                  <div>
                    <strong>Updated</strong>
                    <time>{timestamp(deal.updated_at)}</time>
                  </div>
                </li>
                <li>
                  <span className="live-event-created" aria-hidden="true">
                    +
                  </span>
                  <div>
                    <strong>Created</strong>
                    <time>{timestamp(deal.created_at)}</time>
                  </div>
                </li>
                {events
                  .filter((item) => item.action !== 'created' && item.action !== 'updated')
                  .map((item) => (
                    <li key={item.id}>
                      <FactIcon name="updated" />
                      <div>
                        <strong>
                          {item.actor_name} {item.action.replaceAll('_', ' ')}
                        </strong>
                        <time>{timestamp(item.created_at)}</time>
                      </div>
                    </li>
                  ))}
              </ul>
              {deal.paid_at && <p className="muted">Paid {timestamp(deal.paid_at)}</p>}
              {deal.status === 'archived' && (
                <p className="muted">
                  Outcome: {deal.outcome === 'none' ? 'None' : deal.outcome === 'lost' ? 'Lost' : 'Cancelled'}
                </p>
              )}
            </section>
            <p className="live-detail-footnote">
              Version {deal.version} · Paid is a pipeline stage. Invoice revenue is tracked separately.
            </p>
          </div>
        )}
        {tab === 'tasks' && <RelatedTasks clientId={deal.client} dealId={deal.id} />}
        {tab === 'invoices' && (
          <section className="live-detail-invoices">
            <h3>Linked invoices</h3>
            {invoiceError ? (
              <p role="alert">{invoiceError}</p>
            ) : invoicesLoading ? (
              <p role="status" className="muted">
                Loading invoices…
              </p>
            ) : linkedInvoices.length ? (
              <ul>
                {linkedInvoices.map((invoice) => (
                  <li key={invoice.id}>
                    <button
                      className="client-name"
                      onClick={() => {
                        window.location.hash = `/invoices?invoice=${encodeURIComponent(invoice.id)}`;
                      }}
                    >
                      {invoice.invoice_number} · {invoiceMoney(invoice.total_amount, invoice.currency)} →
                    </button>
                    <InvoiceStatus status={invoice.status} overdue={invoice.overdue} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No invoices linked to this deal.</p>
            )}
          </section>
        )}
        {tab === 'notes' && (
          <section className="live-detail-notes">
            <h3>
              <ClientSectionIcon name="notes" />
              Deal notes
            </h3>
            <p className="muted">Shared with your company and visible on the client record.</p>
            {noteMessage && <p role="status">{noteMessage}</p>}
            {activityError && <p role="alert">{activityError}</p>}
            {noteError && (
              <p role="alert">
                {noteError}{' '}
                <button className="secondary" onClick={() => setNoteRevision((value) => value + 1)}>
                  Retry notes
                </button>
              </p>
            )}
            {notesLoading ? (
              <p role="status">Loading notes…</p>
            ) : notes?.results.length ? (
              <ul>
                {notes.results.map((note) => (
                  <li key={note.id}>
                    <span className="deal-note-avatar" aria-hidden="true">
                      {initials(note.author.username)}
                    </span>
                    <div className="deal-note-content">
                      <div className="deal-note-meta">
                        <strong>{note.author.username}</strong>
                        <time>{timestamp(note.created_at)}</time>
                        {note.can_delete && (
                          <button
                            className="text-action danger"
                            disabled={posting}
                            onClick={() => void removeNote(note)}
                          >
                            <ClientSectionIcon name="delete" />
                            Delete
                          </button>
                        )}
                      </div>
                      <p>{note.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              !noteError && <p className="muted">No notes for this deal yet.</p>
            )}
            {notes && (
              <div className="history-pagination">
                <span className="muted">
                  {notes.count} notes · Page {notePage}
                </span>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={notesLoading || !notes.previous}
                    onClick={() => setNotePage((value) => value - 1)}
                  >
                    Previous notes
                  </button>
                  <button
                    className="secondary"
                    disabled={notesLoading || !notes.next}
                    onClick={() => setNotePage((value) => value + 1)}
                  >
                    Next notes
                  </button>
                </div>
              </div>
            )}
            <form onSubmit={addNote}>
              <label className="field">
                New note
                <textarea
                  placeholder="Add a note..."
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={10000}
                  required
                />
              </label>
              <div className="deal-note-actions">
                <button type="button" className="secondary" disabled={posting || !draft} onClick={() => setDraft('')}>
                  Cancel
                </button>
                <button disabled={posting || !draft.trim()}>
                  <ClientSectionIcon name="send" />
                  {posting ? 'Saving...' : 'Add note'}
                </button>
              </div>
            </form>
            <button className="text-action deal-open-client" onClick={onOpenClient}>
              <ClientSectionIcon name="external" />
              Open client record ?
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
