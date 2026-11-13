import { useEffect, useState } from 'react';
import { activity, type ActivityEvent, type ActivityPage as Page } from './api';
import ActionIcon from '../../components/ActionIcon';
import './activity.css';

const labels: Record<string, string> = {
  status: 'Status', amount: 'Amount', currency: 'Currency', deadline: 'Deadline',
  title: 'Title', assignee: 'Assignee', due_at: 'Due date', total_amount: 'Total',
  due_date: 'Payment due', deal_id: 'Linked deal', name: 'Name', company: 'Company',
  payment_amount: 'Payment', received_on: 'Received on',
};
const actionLabel = (action: string) => ({ created: 'created', updated: 'updated', edited: 'edited', deleted: 'deleted', payment_recorded: 'recorded a payment for', email_sent: 'emailed', reminder_sent: 'sent a reminder for' })[action] || action.replaceAll('_', ' ');
const valueLabel = (value: string | number | null) => value == null || value === '' ? 'None' : String(value).replaceAll('_', ' ');
const destination = (event: ActivityEvent) => event.entity_type === 'client' ? `#/clients?client=${event.entity_id}` : event.entity_type === 'deal' ? `#/deals?deal=${event.entity_id}` : event.entity_type === 'invoice' ? `#/invoices?invoice=${event.entity_id}` : '#/tasks';

function Changes({ event }: { event: ActivityEvent }) {
  const entries = Object.entries(event.changes);
  if (!entries.length) return null;
  return <ul className="activity-changes">{entries.map(([field, change]) => <li key={field}><span>{labels[field] || field.replaceAll('_', ' ')}</span>{typeof change === 'object' && change !== null && 'to' in change ? <span>{valueLabel(change.from)} → {valueLabel(change.to)}</span> : <span>{valueLabel(change)}</span>}</li>)}</ul>;
}

export default function ActivityPage() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    activity.list(page, entityType, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load activity.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, entityType, revision]);

  return <section className="activity-page" aria-label="Workspace activity">
    <div className="activity-toolbar"><p className="muted">Recent changes made by your team. Notes remain in each client record.</p><div className="button-row"><label className="activity-filter">Show <select aria-label="Activity type" value={entityType} onChange={event => { setEntityType(event.target.value); setPage(1); }}><option value="">All activity</option><option value="client">Clients</option><option value="deal">Deals</option><option value="task">Tasks</option><option value="invoice">Invoices</option></select></label><button className="secondary" onClick={() => setRevision(value => value + 1)}><ActionIcon name="refresh" />Refresh</button></div></div>
    {error && <p role="alert" className="notice error">{error} <button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {loading ? <p role="status">Loading activity…</p> : data && <div className="panel activity-list">{data.results.length ? <ul>{data.results.map(event => <li key={event.id}><div className="activity-entry"><p><strong>{event.actor_name}</strong> {actionLabel(event.action)} {event.entity_type} {event.action === 'deleted' ? <span>{event.entity_label}</span> : <a href={destination(event)}>{event.entity_label}</a>}</p><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time></div><Changes event={event} /></li>)}</ul> : <p className="activity-empty">No activity recorded yet. New changes will appear here.</p>}<footer className="pagination"><span>{data.count} events · Page {page}</span><div className="button-row"><button className="secondary" disabled={!data.previous} onClick={() => setPage(value => value - 1)}>Previous</button><button className="secondary" disabled={!data.next} onClick={() => setPage(value => value + 1)}>Next</button></div></footer></div>}
  </section>;
}
