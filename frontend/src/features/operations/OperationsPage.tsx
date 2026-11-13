import { useEffect, useState } from 'react';
import { invoices, type ReminderPreview } from '../invoices/api';
import { tasks } from '../tasks/api';
import { operations, type DueItem, type OperationsOverview } from './api';
import ActionIcon from '../../components/ActionIcon';
import './operations.css';

type View = 'today' | 'reminders';
const destination = (item: DueItem) => item.kind === 'task' ? '#/tasks' : item.kind === 'deal' ? `#/deals?deal=${encodeURIComponent(item.id)}` : `#/invoices?invoice=${encodeURIComponent(item.id)}`;
const dueLabel = (value: string) => value.includes('T')
  ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  : new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { dateStyle: 'medium' });

export default function OperationsPage({ onCountChanged }: { onCountChanged: () => void }) {
  const [view, setView] = useState<View>('today');
  const [data, setData] = useState<OperationsOverview | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [preview, setPreview] = useState<{ item: DueItem; content: ReminderPreview } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    operations.overview(controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load your operations.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  async function complete(item: DueItem) {
    setBusyId(item.id); setError(''); setMessage('');
    try {
      await tasks.update(item.id, { status: 'done' });
      setMessage('Task completed.'); setRevision(value => value + 1); onCountChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to complete the task.'); }
    finally { setBusyId(''); }
  }

  async function review(item: DueItem) {
    setBusyId(item.id); setError(''); setPreview(null);
    try { setPreview({ item, content: await invoices.reminderPreview(item.id) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to prepare the reminder.'); }
    finally { setBusyId(''); }
  }

  async function sendReminder() {
    if (!preview) return;
    const id = preview.item.id;
    setBusyId(id); setError(''); setMessage('');
    try {
      await invoices.remind(id);
      setPreview(null); setMessage('Reminder accepted by the mail server.'); setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to send the reminder.'); }
    finally { setBusyId(''); }
  }

  const current = data?.[view];
  return <section className="operations-page" aria-label="Workspace operations">
    <div className="operations-intro"><div><h2>Work that needs attention</h2><p className="muted">Your next tasks and the workspace deadlines that matter now.</p></div><button className="secondary" onClick={() => setRevision(value => value + 1)}><ActionIcon name="refresh" />Refresh</button></div>
    <div className="operations-tabs" role="group" aria-label="Operations views"><button aria-pressed={view === 'today'} onClick={() => { setView('today'); setPreview(null); }}>Today {data && <span>{data.today.count}</span>}</button><button aria-pressed={view === 'reminders'} onClick={() => { setView('reminders'); setPreview(null); }}>Reminders {data && <span>{data.reminders.count}</span>}</button><a href="#/activity">Activity →</a></div>
    {error && <p role="alert" className="notice error">{error} <button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {message && <p role="status" className="notice success">{message}</p>}
    {loading ? <p role="status">Loading operations…</p> : current && <div className="panel operations-list"><p className="operations-list-caption">{view === 'today' ? 'Open tasks assigned to you, plus invoice and deal deadlines within seven days.' : 'Unpaid sent invoices and active deal deadlines within seven days.'}</p>{current.results.length ? <ul>{current.results.map(item => <li key={`${item.kind}-${item.id}`}><div className="operations-item-main"><span className="operations-kind">{item.kind}</span><a href={destination(item)}>{item.title}</a><small>{item.subtitle}</small></div><time className={item.overdue ? 'is-overdue' : ''} dateTime={item.due_at}>{item.overdue ? 'Overdue · ' : ''}{dueLabel(item.due_at)}</time><div className="operations-item-actions">{view === 'today' && item.kind === 'task' && <button className="secondary" disabled={!!busyId} onClick={() => void complete(item)}><ActionIcon name="check" />Complete</button>}{view === 'reminders' && item.kind === 'invoice' && item.overdue && <button className="secondary" disabled={!!busyId} onClick={() => void review(item)}><ActionIcon name="send" />Review reminder</button>}<a href={destination(item)}>Open →</a></div></li>)}</ul> : <p className="operations-empty">{view === 'today' ? 'Nothing needs your attention in the next seven days.' : 'No invoice or deal deadlines need a reminder.'}</p>}<footer>{current.count} items{current.count > current.results.length && ` · Showing the next ${current.results.length}`}</footer></div>}
    {preview && <div className="panel operations-reminder"><div><h2>Review payment reminder</h2><button className="secondary" onClick={() => setPreview(null)}><ActionIcon name="close" />Close</button></div><p><strong>{preview.content.subject}</strong></p><pre>{preview.content.body}</pre>{preview.content.reason && <p className="muted">{preview.content.reason}</p>}<button className="primary" disabled={!preview.content.can_send || !!busyId} onClick={() => void sendReminder()}><ActionIcon name="send" />Send reminder email</button></div>}
  </section>;
}
