import { useEffect, useState } from 'react';
import { tasks, type Task, type TaskPage } from './api';
import ClientSectionIcon from '../clients/ClientSectionIcon';
import './related-tasks.css';

const dueLabel = (value: string) =>
  new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export default function RelatedTasks({
  clientId,
  dealId,
  onChanged,
}: {
  clientId?: string;
  dealId?: string;
  onChanged?: () => void;
}) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | 'open' | 'done'>('');
  const [data, setData] = useState<TaskPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [clientId, dealId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    tasks
      .list({ client: clientId, deal: dealId, page, ...(status ? { status } : {}) }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Unable to load related tasks.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [clientId, dealId, page, status, revision]);

  async function toggle(task: Task) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await tasks.update(task.id, { status: task.status === 'done' ? 'open' : 'done' });
      setRevision((value) => value + 1);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the task.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="related-tasks" aria-label="Related tasks">
      <header className="related-tasks-heading">
        <h3>Tasks {data && <span className="client-deal-count">{data.count}</span>}</h3>
        <div>
          <select
            aria-label="Filter related tasks"
            value={status}
            disabled={busy}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="">All tasks</option>
            <option value="open">Open</option>
            <option value="done">Done</option>
          </select>
          <a
            className="related-task-add"
            href={`#/tasks?${new URLSearchParams({ new: '1', ...(clientId ? { client: clientId } : {}), ...(dealId ? { deal: dealId } : {}) })}`}
          >
            <span aria-hidden="true">+</span>Add task
          </a>
        </div>
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
          <button className="text-action" onClick={() => setRevision((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {loading ? (
        <p role="status" className="muted">
          Loading tasks...
        </p>
      ) : data?.results.length ? (
        <ul className="related-task-list">
          {data.results.map((task) => (
            <li key={task.id} className={task.status === 'done' ? 'is-done' : ''}>
              <input
                type="checkbox"
                aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}
                checked={task.status === 'done'}
                disabled={busy}
                onChange={() => void toggle(task)}
              />
              <a className="related-task-title" href={`#/tasks?task=${encodeURIComponent(task.id)}`}>
                {task.title}
              </a>
              <span className={`related-task-status task-${task.status}`}>
                <i aria-hidden="true" />
                {task.status === 'done' ? 'Done' : 'Open'}
              </span>
              <time
                dateTime={task.due_at}
                className={task.status === 'open' && new Date(task.due_at) < new Date() ? 'is-overdue' : ''}
              >
                <ClientSectionIcon name="calendar" />
                {dueLabel(task.due_at)}
              </time>
              <a
                className="related-task-edit"
                href={`#/tasks?task=${encodeURIComponent(task.id)}`}
                aria-label={`Edit ${task.title}`}
              >
                <ClientSectionIcon name="edit" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        !error && <p className="muted">No related tasks.</p>
      )}
      {data && (data.next || data.previous) && (
        <div className="history-pagination">
          <button
            className="secondary"
            disabled={!data.previous || loading || busy}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            className="secondary"
            disabled={!data.next || loading || busy}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
