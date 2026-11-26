import DateInput from '../../components/DateInput';
import { formatDate, formatDateTime } from '../../utils/dates';
import { useEffect, useState, type FormEvent } from 'react';
import { activity, type ActivityEvent, type ActivityPage as Page } from './api';
import './activity.css';

const labels: Record<string, string> = {
  status: 'Status',
  amount: 'Amount',
  currency: 'Currency',
  deadline: 'Deadline',
  title: 'Title',
  assignee: 'Assignee',
  due_at: 'Due date',
  total_amount: 'Total',
  due_date: 'Payment due',
  deal_id: 'Linked deal',
  name: 'Name',
  company: 'Company',
  payment_amount: 'Payment',
  received_on: 'Received on',
  member: 'Member',
  contact: 'Contact',
  link: 'Link',
  file: 'File',
};
const actionLabel = (action: string) =>
  ({
    created: 'created',
    description_updated: 'updated the description of',
    updated: 'updated',
    edited: 'edited',
    deleted: 'deleted',
    payment_recorded: 'recorded a payment for',
    email_sent: 'emailed',
    reminder_sent: 'sent a reminder for',
    note_added: 'added a note to',
    note_deleted: 'deleted a note from',
    link_added: 'added a link to',
    link_updated: 'updated a link on',
    link_deleted: 'deleted a link from',
    contact_added: 'added a contact to',
    contact_updated: 'updated a contact on',
    contact_deleted: 'deleted a contact from',
    attachment_added: 'added a file to',
    attachment_deleted: 'deleted a file from',
    payer_bank_updated: 'updated payer bank details for',
    payment_details_updated: 'updated payment details for',
    member_added: 'added a member to',
    member_removed: 'removed a member from',
  })[action] || action.replaceAll('_', ' ');
const valueLabel = (value: string | number | null) =>
  value == null || value === '' ? 'None' : String(value).replaceAll('_', ' ');
const destination = (event: ActivityEvent) =>
  event.entity_type === 'client'
    ? `#/clients?client=${event.entity_id}`
    : event.entity_type === 'deal'
      ? `#/deals?deal=${event.entity_id}`
      : event.entity_type === 'invoice'
        ? `#/invoices?invoice=${event.entity_id}`
        : event.entity_type === 'task'
          ? `#/tasks?task=${event.entity_id}`
          : '#/settings?section=workspace';

function Changes({ event }: { event: ActivityEvent }) {
  const entries = Object.entries(event.changes);
  const display = (field: string, value: string | number | null) =>
    value && ['due_date', 'received_on'].includes(field)
      ? formatDate(String(value))
      : value && ['deadline', 'due_at'].includes(field)
        ? formatDateTime(String(value))
        : valueLabel(value);
  if (!entries.length) return null;
  return (
    <ul className="activity-changes">
      {entries.map(([field, change]) => (
        <li key={field}>
          <span>{labels[field] || field.replaceAll('_', ' ')}</span>
          {typeof change === 'object' && change !== null && 'to' in change ? (
            <span>
              {display(field, change.from)} → {display(field, change.to)}
            </span>
          ) : (
            <span>{valueLabel(change)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ActivityPage() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [authorInput, setAuthorInput] = useState('');
  const [author, setAuthor] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    activity
      .list(page, entityType, controller.signal, author, dateFrom, dateTo)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Unable to load activity.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, entityType, author, dateFrom, dateTo, revision]);

  function searchAuthor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthor(authorInput.trim());
    setPage(1);
  }

  return (
    <section className="activity-page" aria-label="Workspace activity">
      <div className="activity-toolbar">
        <p className="muted">Follow changes made by your workspace.</p>
        <div className="activity-controls">
          <label className="activity-filter">
            Type
            <select
              aria-label="Activity type"
              value={entityType}
              onChange={(event) => {
                setEntityType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All activity</option>
              <option value="client">Clients</option>
              <option value="deal">Deals</option>
              <option value="task">Tasks</option>
              <option value="invoice">Invoices</option>
              <option value="workspace">Workspace</option>
            </select>
          </label>
          <form className="activity-search" onSubmit={searchAuthor}>
            <label className="activity-filter">
              Author
              <input
                aria-label="Search activity author"
                placeholder="Search by name"
                value={authorInput}
                maxLength={150}
                onChange={(event) => setAuthorInput(event.target.value)}
              />
            </label>
            <button className="secondary">Search</button>
          </form>
          <label className="activity-filter">
            From
            <DateInput
              aria-label="Activity from date"
              defaultValue={dateFrom}
              max={dateTo || undefined}
              onCommit={(value) => {
                setDateFrom(value);
                setPage(1);
              }}
            />
          </label>
          <label className="activity-filter">
            To
            <DateInput
              aria-label="Activity to date"
              defaultValue={dateTo}
              min={dateFrom || undefined}
              onCommit={(value) => {
                setDateTo(value);
                setPage(1);
              }}
            />
          </label>
          <button className="secondary activity-refresh" onClick={() => setRevision((value) => value + 1)}>
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}{' '}
          <button className="secondary" onClick={() => setRevision((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {loading ? (
        <p role="status">Loading activity…</p>
      ) : (
        data && (
          <div className="panel activity-list">
            <div className="activity-list-heading">
              <h2>Recent activity</h2>
              <span className="muted">{data.count} events</span>
            </div>
            {data.results.length ? (
              <ul>
                {data.results.map((event) => (
                  <li key={event.id} className="activity-entry">
                    <div className="activity-entry-content">
                      <p>
                        <strong>{event.actor_name}</strong> {actionLabel(event.action)} {event.entity_type}{' '}
                        {event.action === 'deleted' ? (
                          <span>{event.entity_label}</span>
                        ) : (
                          <a href={destination(event)}>{event.entity_label}</a>
                        )}
                      </p>
                      <Changes event={event} />
                    </div>
                    <time dateTime={event.created_at}>
                      {new Date(event.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="activity-empty">
                {entityType || author || dateFrom || dateTo
                  ? 'No activity matches these filters.'
                  : 'No activity recorded yet. New changes will appear here.'}
              </p>
            )}
            <footer className="pagination">
              <span>
                {data.count} events · Page {page}
              </span>
              <div className="button-row">
                <button className="secondary" disabled={!data.previous} onClick={() => setPage((value) => value - 1)}>
                  Previous
                </button>
                <button className="secondary" disabled={!data.next} onClick={() => setPage((value) => value + 1)}>
                  Next
                </button>
              </div>
            </footer>
          </div>
        )
      )}
    </section>
  );
}
