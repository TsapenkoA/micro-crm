import { useEffect, useRef, useState, type FormEvent } from 'react';
import { workspace, type WorkspaceSettings, type User } from '../../api/client';
import ActionIcon from '../../components/ActionIcon';
import { deals, type Deal } from '../deals/api';
import type { Client } from '../clients/api';
import { tasks, type Task, type TaskFilters, type TaskInput, type TaskPage } from './api';
import './tasks.css';

type View = 'mine' | 'team' | 'overdue' | 'upcoming' | 'done';
const views: { id: View; label: string; filters: TaskFilters }[] = [
  { id: 'mine', label: 'My tasks', filters: { mine: true, status: 'open' } },
  { id: 'team', label: 'Team', filters: { status: 'open' } },
  { id: 'overdue', label: 'Overdue', filters: { due: 'overdue' } },
  { id: 'upcoming', label: 'Upcoming', filters: { due: 'upcoming' } },
  { id: 'done', label: 'Done', filters: { status: 'done' } },
];
const localDateTime = (value: string) => {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const dueLabel = (value: string) => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const link = (task: Task) => task.deal ? `#/deals?deal=${encodeURIComponent(task.deal)}` : `#/clients?client=${encodeURIComponent(task.client)}`;

export default function TasksPage({ user, search = '', onCountChanged }: { user: User; search?: string; onCountChanged?: () => void }) {
  const [view, setView] = useState<View>('mine');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<TaskPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Task | 'new' | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [dealsList, setDealsList] = useState<Deal[]>([]);
  const [members, setMembers] = useState<WorkspaceSettings['members']>([]);
  const [choicesLoading, setChoicesLoading] = useState(true);
  const [formError, setFormError] = useState('');
  const [selectedClient, setSelectedClient] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [dealFilter, setDealFilter] = useState('');
  const [myCount, setMyCount] = useState<number | null>(null);
  const selectedInitially = useRef(false);

  useEffect(() => { setPage(1); }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    tasks.list({ ...views.find(item => item.id === view)!.filters, page, search, client: clientFilter, deal: dealFilter }, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); if (view === 'mine' && !search && !clientFilter && !dealFilter) setMyCount(result.count); if (!selectedInitially.current && result.results.length) { setEditor(result.results[0]); selectedInitially.current = true; } } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load tasks.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, page, revision, search, clientFilter, dealFilter]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([workspace.settings(), deals.clients(controller.signal), deals.list({ search: '', status: '', currency: '' }, controller.signal)])
      .then(([settings, clientRows, dealRows]) => { if (!controller.signal.aborted) { setMembers(settings.members); setClients(clientRows); setDealsList(dealRows.results); } })
      .catch(() => { if (!controller.signal.aborted) setFormError('Unable to load task choices. Refresh to retry.'); })
      .finally(() => { if (!controller.signal.aborted) setChoicesLoading(false); });
    return () => controller.abort();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const due = String(form.get('due_at') ?? '');
    const assignee = Number(form.get('assignee'));
    if (!title || !due || !Number.isFinite(new Date(due).getTime()) || !assignee) { setFormError('Enter a title, due date and assignee.'); return; }
    setBusy(true); setFormError(''); setMessage('');
    try {
      if (editor === 'new') {
        const payload: TaskInput = { title, due_at: new Date(due).toISOString(), assignee, client: String(form.get('client')), deal: String(form.get('deal')) || null };
        await tasks.create(payload);
        onCountChanged?.();
        setMessage('Task created.');
      } else {
        await tasks.update(editor.id, { title, due_at: new Date(due).toISOString(), assignee });
        setMessage('Task updated.');
      }
      setEditor(null); setRevision(value => value + 1);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Unable to save the task.'); }
    finally { setBusy(false); }
  }

  async function setStatus(task: Task) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await tasks.update(task.id, { status: task.status === 'open' ? 'done' : 'open' });
      setMessage(task.status === 'open' ? 'Task completed.' : 'Task reopened.');
      setEditor(null);
      setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update the task.'); }
    finally { setBusy(false); }
  }

  const currentClient = selectedClient || clients[0]?.id || '';
  return <section className="tasks-page" aria-label="Workspace tasks">
    <div className="tasks-toolbar"><div className="tasks-tabs" role="group" aria-label="Task filters">{views.map(item => <button key={item.id} aria-pressed={view === item.id} onClick={() => { setView(item.id); setPage(1); setEditor(null); }}>{item.label}{item.id === 'mine' && myCount !== null && <span className="tasks-tab-count">{myCount}</span>}</button>)}</div><div className="tasks-toolbar-actions"><label className="tasks-filter"><span>Clients</span><select aria-label="Filter tasks by client" value={clientFilter} onChange={event => { setClientFilter(event.target.value); setDealFilter(''); setPage(1); }}><option value="">All clients</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="tasks-filter"><span>Deals</span><select aria-label="Filter tasks by deal" value={dealFilter} onChange={event => { setDealFilter(event.target.value); setPage(1); }}><option value="">All deals</option>{dealsList.filter(deal => !clientFilter || deal.client === clientFilter).map(deal => <option key={deal.id} value={deal.id}>{deal.title}</option>)}</select></label><button className="primary tasks-new" disabled={choicesLoading || !clients.length || !members.length} onClick={() => { setFormError(''); setEditor('new'); }}><ActionIcon name="add" />New task</button></div></div>
    {!choicesLoading && !clients.length && !formError && <p className="muted">Create a client before adding a task.</p>}
    {!editor && formError && <p role="alert" className="notice error">{formError}</p>}
    {error && <div className="notice error" role="alert">{error} <button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {message && <p className="notice success" role="status">{message}</p>}
    <div className="tasks-content"><div className="panel tasks-list">{loading ? <p role="status" className="tasks-empty">Loading tasks…</p> : data && (data.results.length ? <ul>{data.results.map(task => <li key={task.id} className={editor !== 'new' && editor?.id === task.id ? 'is-selected' : ''}>
      <input type="checkbox" aria-label={`${task.status === 'open' ? 'Complete' : 'Reopen'} ${task.title}`} checked={task.status === 'done'} disabled={busy} onChange={() => void setStatus(task)} />
      <div className="task-summary"><button className="task-title" onClick={() => { setFormError(''); setEditor(task); }}>{task.title}</button><small><a href={link(task)}>{task.deal_title || task.client_name}</a> · {task.assignee_name || 'Unassigned'}</small></div>
      <time className={task.status === 'open' && new Date(task.due_at) < new Date() ? 'is-overdue' : ''} dateTime={task.due_at}><span aria-hidden="true">▣</span>{dueLabel(task.due_at)}</time>
      <div className="task-row-actions"><button className="secondary" disabled={busy} onClick={() => void setStatus(task)}><ActionIcon name={task.status === 'open' ? 'check' : 'refresh'} />{task.status === 'open' ? 'Complete' : 'Reopen'}</button><button className="task-more" aria-label={`Edit ${task.title}`} disabled={busy} onClick={() => { setFormError(''); setEditor(task); }}>⋯</button></div>
    </li>)}</ul> : <p className="tasks-empty">{view === 'overdue' ? 'No overdue tasks.' : view === 'done' ? 'No completed tasks yet.' : 'No tasks in this view.'}</p>)}
      {data && <footer className="pagination"><span>{data.count} tasks</span><div className="button-row"><button className="secondary" aria-label="Previous page" disabled={!data.previous} onClick={() => setPage(value => value - 1)}>‹</button><span className="tasks-page-number">{page}</span><button className="secondary" aria-label="Next page" disabled={!data.next} onClick={() => setPage(value => value + 1)}>›</button></div></footer>}
    </div>
    {editor ? <div className="panel tasks-editor"><h2>{editor === 'new' ? 'New task' : 'Edit task'}</h2><form className="auth-form" onSubmit={save} key={editor === 'new' ? 'new' : editor.id}>
      <label className="field">Title<input name="title" defaultValue={editor === 'new' ? '' : editor.title} maxLength={250} required disabled={busy} autoFocus /></label>
      {editor === 'new' && <><label className="field">Client<select name="client" value={currentClient} required disabled={busy} onChange={event => setSelectedClient(event.target.value)}>{clients.map(client => <option key={client.id} value={client.id}>{client.name}{client.company ? ` · ${client.company}` : ''}</option>)}</select></label>
        <label className="field">Deal (optional)<select key={currentClient} name="deal" defaultValue="" disabled={busy}><option value="">No deal</option>{dealsList.filter(deal => deal.client === currentClient).map(deal => <option key={deal.id} value={deal.id}>{deal.title}</option>)}</select></label></>}
      <label className="field">Assignee<select name="assignee" defaultValue={editor === 'new' ? user.id : editor.assignee ?? ''} required disabled={busy}><option value="" disabled>Choose a member</option>{members.map(member => <option key={member.id} value={member.id}>{member.name || member.username}</option>)}</select></label>
      <label className="field">Due date<input name="due_at" type="datetime-local" defaultValue={editor === 'new' ? '' : localDateTime(editor.due_at)} required disabled={busy} /></label>
      {formError && <p role="alert" className="notice error">{formError}</p>}
      <div className="button-row"><button type="button" className="secondary" disabled={busy} onClick={() => setEditor(null)}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : editor === 'new' ? 'Create task' : 'Save'}</button></div>
    </form></div> : <div className="panel tasks-editor tasks-editor-empty"><h2>Task details</h2><p className="muted">Select a task to edit it, or create a new one.</p></div>}</div>
  </section>;
}
