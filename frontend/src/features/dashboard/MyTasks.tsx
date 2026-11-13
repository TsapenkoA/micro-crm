import { useEffect, useState } from 'react';
import { tasks, type Task } from '../tasks/api';

export default function MyTasks({ onNavigate }: { onNavigate: () => void }) {
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    tasks.list({ mine: true, status: 'open', page_size: 5 }, controller.signal)
      .then(page => { if (!controller.signal.aborted) setItems(page.results); })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load your next tasks.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  return <section className="panel dashboard-recent"><div className="dashboard-section-heading"><div><h2>Your next tasks</h2><p className="muted">Overdue actions appear first</p></div><button className="secondary" onClick={onNavigate}>View tasks</button></div>
    {loading ? <p role="status" className="dashboard-task-empty">Loading tasks…</p> : error ? <p role="alert" className="dashboard-task-empty">{error} <button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry</button></p> : items.length ? <ul className="dashboard-task-list">{items.map(task => <li key={task.id}><a href={task.deal ? `#/deals?deal=${encodeURIComponent(task.deal)}` : `#/clients?client=${encodeURIComponent(task.client)}`}>{task.title}</a><span>{task.deal_title || task.client_name}</span><time className={new Date(task.due_at) < new Date() ? 'is-overdue' : ''} dateTime={task.due_at}>{new Date(task.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</time></li>)}</ul> : <p className="dashboard-task-empty">No open tasks assigned to you.</p>}
  </section>;
}
