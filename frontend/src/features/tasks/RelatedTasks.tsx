import { useEffect, useState } from 'react';
import { tasks, type TaskPage } from './api';

const dueLabel = (value: string) => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export default function RelatedTasks({ clientId, dealId }: { clientId?: string; dealId?: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TaskPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { setPage(1); }, [clientId, dealId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    tasks.list({ client: clientId, deal: dealId, page }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load related tasks.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clientId, dealId, page]);

  return <section className="live-detail-section"><h3>Tasks{data && ` (${data.count})`}</h3>
    {loading ? <p role="status" className="muted">Loading tasks…</p> : error ? <p role="alert">{error}</p> : data?.results.length ? <ul>{data.results.map(task => <li key={task.id}><a href={`#/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</a><small className="muted"> · {task.status === 'done' ? 'Done' : 'Open'} · {dueLabel(task.due_at)}</small></li>)}</ul> : <p className="muted">No related tasks.</p>}
    {data && data.count > 20 && <div className="button-row"><button className="secondary" disabled={!data.previous} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button className="secondary" disabled={!data.next} onClick={() => setPage(value => value + 1)}>Next</button></div>}
    <a href={`#/tasks?${new URLSearchParams({ new: '1', ...(clientId ? { client: clientId } : {}), ...(dealId ? { deal: dealId } : {}) })}`}>New task →</a>
  </section>;
}
