import { Fragment, useEffect, useState } from 'react';
import { invoices, type ReminderPreview } from '../invoices/api';
import { tasks } from '../tasks/api';
import { operations, type DueItem, type InvoiceDeliveryAttempt, type OperationsOverview } from './api';
import ActionIcon from '../../components/ActionIcon';
import './operations.css';

type View = 'today' | 'reminders';
const destination = (item: DueItem) =>
  item.kind === 'task'
    ? `#/tasks?task=${encodeURIComponent(item.id)}`
    : item.kind === 'deal'
      ? `#/deals?deal=${encodeURIComponent(item.id)}`
      : `#/invoices?invoice=${encodeURIComponent(item.id)}`;
const dueLabel = (value: string) =>
  value.includes('T')
    ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { dateStyle: 'medium' });
const dueGroup = (item: DueItem) => {
  if (item.overdue) return 'Overdue';
  const day = item.due_at.slice(0, 10);
  const today = new Date();
  const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return day === localDay ? 'Today' : 'Next seven days';
};

export default function OperationsPage({
  onCountChanged,
  isPlatformAdmin = false,
}: {
  onCountChanged: () => void;
  isPlatformAdmin?: boolean;
}) {
  const [view, setView] = useState<View>('today');
  const [page, setPage] = useState(1);
  const [undatedPage, setUndatedPage] = useState(1);
  const [data, setData] = useState<OperationsOverview | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [preview, setPreview] = useState<{ item: DueItem; content: ReminderPreview } | null>(null);
  const [deliveryAttempts, setDeliveryAttempts] = useState<InvoiceDeliveryAttempt[]>([]);
  const [deliveryCount, setDeliveryCount] = useState(0);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState('');
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const [deliveryReason, setDeliveryReason] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    operations
      .overview(controller.signal, page, undatedPage)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Unable to load your operations.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, page, undatedPage]);

  useEffect(() => {
    if (!isPlatformAdmin) {
      setDeliveryAttempts([]);
      setDeliveryCount(0);
      return;
    }
    const controller = new AbortController();
    setDeliveryLoading(true);
    setDeliveryError('');
    operations
      .pendingDeliveries(controller.signal, deliveryPage)
      .then((result) => {
        if (!controller.signal.aborted) {
          setDeliveryAttempts(result.results);
          setDeliveryCount(result.count);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDeliveryError('Unable to load unresolved invoice email attempts.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setDeliveryLoading(false);
      });
    return () => controller.abort();
  }, [deliveryPage, isPlatformAdmin, revision]);

  async function complete(item: DueItem) {
    setBusyId(item.id);
    setError('');
    setMessage('');
    try {
      await tasks.update(item.id, { status: 'done' });
      setMessage('Task completed.');
      setRevision((value) => value + 1);
      onCountChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to complete the task.');
    } finally {
      setBusyId('');
    }
  }

  async function review(item: DueItem) {
    setBusyId(item.id);
    setError('');
    setPreview(null);
    try {
      setPreview({ item, content: await invoices.reminderPreview(item.id) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare the reminder.');
    } finally {
      setBusyId('');
    }
  }

  async function sendReminder() {
    if (!preview) return;
    const id = preview.item.id;
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      await invoices.remind(id);
      setPreview(null);
      setMessage('Reminder accepted by the mail server.');
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send the reminder.');
    } finally {
      setBusyId('');
    }
  }

  async function resolveDelivery(attempt: InvoiceDeliveryAttempt, outcome: 'accepted' | 'failed') {
    const reason = deliveryReason[attempt.id]?.trim() ?? '';
    if (!reason) {
      setDeliveryError('Enter an investigation reason before resolving an email attempt.');
      return;
    }
    setResolvingId(attempt.id);
    setDeliveryError('');
    setDeliveryMessage('');
    try {
      await operations.resolveDelivery(attempt.id, outcome, reason);
      setDeliveryReason((currentReasons) => {
        const next = { ...currentReasons };
        delete next[attempt.id];
        return next;
      });
      setDeliveryMessage(
        outcome === 'failed'
          ? 'Attempt resolved as not accepted. Retrying is now allowed; verify the provider result to avoid a duplicate.'
          : 'Attempt resolved as accepted. Retrying remains blocked.',
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setDeliveryError(cause instanceof Error ? cause.message : 'Unable to resolve the email attempt.');
    } finally {
      setResolvingId('');
    }
  }

  const current = data?.[view];
  return (
    <section className="operations-page" aria-label="Workspace operations">
      <div className="operations-intro">
        <div>
          <h2>Work that needs attention</h2>
          <p className="muted">Your assigned tasks and shared deadlines, overdue or due in the next seven days.</p>
        </div>
        <div className="button-row">
          <a className="secondary" href="#/tasks?new=1">
            <ActionIcon name="add" />
            New task
          </a>
          <button className="secondary" onClick={() => setRevision((value) => value + 1)}>
            <ActionIcon name="refresh" />
            Refresh
          </button>
        </div>
      </div>
      <div className="operations-tabs" role="group" aria-label="Operations views">
        <button
          aria-pressed={view === 'today'}
          onClick={() => {
            setView('today');
            setPage(1);
            setPreview(null);
          }}
        >
          My work {data && <span>{data.today.count}</span>}
        </button>
        <button
          aria-pressed={view === 'reminders'}
          onClick={() => {
            setView('reminders');
            setPage(1);
            setPreview(null);
          }}
        >
          Shared deadlines {data && <span>{data.reminders.count}</span>}
        </button>
        <a href="#/activity">Activity →</a>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}{' '}
          <button className="secondary" onClick={() => setRevision((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="notice success">
          {message}
        </p>
      )}
      {isPlatformAdmin && (
        <section className="panel operations-delivery-review" aria-label="Unresolved invoice email attempts">
          <div className="operations-delivery-heading">
            <div>
              <h2>Unresolved invoice email attempts</h2>
              <p className="muted">
                Only platform administrators can resolve these attempts. Confirm the provider outcome before choosing an
                action.
              </p>
            </div>
            <button className="secondary" disabled={deliveryLoading} onClick={() => setRevision((value) => value + 1)}>
              <ActionIcon name="refresh" />
              Refresh
            </button>
          </div>
          <p className="notice warning">
            Resolving an attempt as failed allows a resend. If the mail server actually accepted it, that resend may
            create a duplicate email.
          </p>
          {deliveryError && (
            <p role="alert" className="notice error">
              {deliveryError}
            </p>
          )}
          {deliveryMessage && (
            <p role="status" className="notice success">
              {deliveryMessage}
            </p>
          )}
          {deliveryLoading ? (
            <p role="status">Loading unresolved attempts…</p>
          ) : deliveryAttempts.length ? (
            <ul className="operations-delivery-list">
              {deliveryAttempts.map((attempt) => (
                <li key={attempt.id}>
                  <div className="operations-delivery-summary">
                    <strong>
                      {attempt.invoice_number} · {attempt.kind === 'invoice' ? 'Invoice' : 'Reminder'}
                    </strong>
                    <span>
                      {attempt.workspace_name} · {attempt.recipient}
                    </span>
                    <small>
                      {attempt.result === 'unknown' ? 'Outcome unknown' : 'Still pending'} ·{' '}
                      {dueLabel(attempt.attempted_at)}
                    </small>
                  </div>
                  <label>
                    Investigation reason
                    <input
                      maxLength={500}
                      value={deliveryReason[attempt.id] ?? ''}
                      onChange={(event) =>
                        setDeliveryReason((currentReasons) => ({ ...currentReasons, [attempt.id]: event.target.value }))
                      }
                    />
                  </label>
                  <div className="button-row">
                    <button
                      className="secondary"
                      disabled={!!resolvingId || !deliveryReason[attempt.id]?.trim()}
                      onClick={() => void resolveDelivery(attempt, 'accepted')}
                    >
                      {resolvingId === attempt.id ? 'Resolving…' : 'Resolve as accepted'}
                    </button>
                    <button
                      className="primary destructive"
                      disabled={!!resolvingId || !deliveryReason[attempt.id]?.trim()}
                      onClick={() => void resolveDelivery(attempt, 'failed')}
                    >
                      {resolvingId === attempt.id ? 'Resolving…' : 'Resolve as failed (allow retry)'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="operations-empty">No unresolved invoice email attempts.</p>
          )}
          {deliveryCount > 20 && (
            <footer className="pagination">
              <span>
                {deliveryCount} attempts · Page {deliveryPage}
              </span>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={deliveryPage === 1 || deliveryLoading}
                  onClick={() => setDeliveryPage((value) => value - 1)}
                >
                  Previous
                </button>
                <button
                  className="secondary"
                  disabled={deliveryPage * 20 >= deliveryCount || deliveryLoading}
                  onClick={() => setDeliveryPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          )}
        </section>
      )}
      {data && data.undated_invoices.count > 0 && (
        <details className="panel operations-undated">
          <summary>
            <span>
              <strong>
                {data.undated_invoices.count} {data.undated_invoices.count === 1 ? 'invoice needs' : 'invoices need'} a
                due date
              </strong>
              <small>Open each invoice to correct its due date and enable overdue tracking.</small>
            </span>
            <span className="operations-undated-toggle">Review invoices</span>
          </summary>
          <ul>
            {data.undated_invoices.results.map((invoice) => (
              <li key={invoice.id}>
                <a href={`#/invoices?invoice=${encodeURIComponent(invoice.id)}`}>
                  {invoice.invoice_number} · {invoice.client_name}
                </a>
              </li>
            ))}
          </ul>
          <footer className="pagination">
            <span>Page {undatedPage}</span>
            <div className="button-row">
              <button
                className="secondary"
                disabled={undatedPage === 1 || loading}
                onClick={() => setUndatedPage((value) => value - 1)}
              >
                Previous
              </button>
              <button
                className="secondary"
                disabled={undatedPage * 20 >= data.undated_invoices.count || loading}
                onClick={() => setUndatedPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          </footer>
        </details>
      )}
      {loading ? (
        <p role="status">Loading operations…</p>
      ) : (
        current && (
          <div className="panel operations-list">
            <p className="operations-list-caption">
              {view === 'today'
                ? 'Open tasks assigned to you, plus shared deal and invoice deadlines.'
                : 'Unpaid sent invoices and active deal deadlines.'}
            </p>
            {current.results.length ? (
              <ul>
                {current.results.map((item, index) => (
                  <Fragment key={`${item.kind}-${item.id}`}>
                    {(index === 0 || dueGroup(current.results[index - 1]) !== dueGroup(item)) && (
                      <li className="operations-group">{dueGroup(item)}</li>
                    )}
                    <li>
                      <div className="operations-item-main">
                        <span className="operations-kind">{item.kind}</span>
                        <a href={destination(item)}>{item.title}</a>
                        <small>{item.subtitle}</small>
                      </div>
                      <time className={item.overdue ? 'is-overdue' : ''} dateTime={item.due_at}>
                        {dueLabel(item.due_at)}
                      </time>
                      <div className="operations-item-actions">
                        {view === 'today' && item.kind === 'task' && (
                          <button className="secondary" disabled={!!busyId} onClick={() => void complete(item)}>
                            <ActionIcon name="check" />
                            Complete
                          </button>
                        )}
                        {view === 'reminders' && item.kind === 'invoice' && item.overdue && (
                          <button className="secondary" disabled={!!busyId} onClick={() => void review(item)}>
                            <ActionIcon name="send" />
                            Review reminder
                          </button>
                        )}
                        <a href={destination(item)}>Open →</a>
                      </div>
                    </li>
                  </Fragment>
                ))}
              </ul>
            ) : (
              <p className="operations-empty">No items on this page.</p>
            )}
            <footer className="pagination">
              <span>
                {current.count} items · Page {page}
              </span>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={page === 1 || loading}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </button>
                <button
                  className="secondary"
                  disabled={page * 20 >= current.count || loading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          </div>
        )
      )}
      {preview && (
        <div className="panel operations-reminder">
          <div>
            <h2>Review payment reminder</h2>
            <button className="secondary" onClick={() => setPreview(null)}>
              <ActionIcon name="close" />
              Close
            </button>
          </div>
          <p>
            <strong>{preview.content.subject}</strong>
          </p>
          <pre>{preview.content.body}</pre>
          {preview.content.reason && <p className="muted">{preview.content.reason}</p>}
          <button
            className="primary"
            disabled={!preview.content.can_send || !!busyId}
            onClick={() => void sendReminder()}
          >
            <ActionIcon name="send" />
            Send reminder email
          </button>
        </div>
      )}
    </section>
  );
}
