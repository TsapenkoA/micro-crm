import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { workspace } from '../src/api/client';
import { deals } from '../src/features/deals/api';
import TasksPage from '../src/features/tasks/TasksPage';
import { tasks, type Task } from '../src/features/tasks/api';

const user = { id: 1, username: 'alex', email: 'alex@example.test', workspace: { id: 'workspace', name: 'Studio' } };
const member = { id: 2, username: 'sam', name: 'Sam Parker', email: 'sam@example.test' };
const task: Task = { id: 'task-1', client: 'client-1', client_name: 'Client', deal: null, deal_title: null, title: 'Send brief', assignee: 2, assignee_name: 'Sam Parker', due_at: '2026-12-01T12:00:00Z', status: 'open', completed_at: null, created_by: 1, created_at: '2026-11-12T12:00:00Z', updated_at: '2026-11-12T12:00:00Z' };

afterEach(() => { vi.restoreAllMocks(); window.location.hash = ''; });

function choices() {
  vi.spyOn(tasks, 'counts').mockResolvedValue({ mine: 0, team: 0, overdue: 0, upcoming: 0, done: 0 });
  vi.spyOn(workspace, 'settings').mockResolvedValue({ id: 'workspace', name: 'Studio', can_manage_members: true, members: [{ id: 1, username: 'alex', name: '', email: user.email }, member] });
  vi.spyOn(deals, 'clients').mockResolvedValue([{ id: 'client-1', name: 'Client', company: 'Studio', email: '', phone: '', bank_details: {}, workspace: 'workspace', created_by: 1, created_at: '', updated_at: '' }]);
  vi.spyOn(deals, 'list').mockResolvedValue({ results: [], totals: [] });
}

it('shows an empty task view and creates a task for a teammate', async () => {
  choices();
  const list = vi.spyOn(tasks, 'list').mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  const create = vi.spyOn(tasks, 'create').mockResolvedValue(task);
  const onCountChanged = vi.fn();
  render(<TasksPage user={user} onCountChanged={onCountChanged} />);
  expect(await screen.findByText('No tasks in this view.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'New task' }));
  await userEvent.type(screen.getByLabelText('Title'), 'Send brief');
  await userEvent.selectOptions(screen.getByLabelText('Assignee'), '2');
  fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01T13:00' } });
  await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Send brief', client: 'client-1', assignee: 2 })));
  expect(onCountChanged).toHaveBeenCalledOnce();
  expect(await screen.findByText('Task created.')).toBeInTheDocument();
  expect(list).toHaveBeenCalled();
});

it('shows counts for every task view', async () => {
  choices();
  vi.spyOn(tasks, 'list').mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  vi.mocked(tasks.counts).mockResolvedValue({ mine: 2, team: 6, overdue: 3, upcoming: 4, done: 5 });
  render(<TasksPage user={user} />);
  expect(await screen.findByRole('button', { name: 'My tasks 2' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Team 6' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Overdue 3' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upcoming 4' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done 5' })).toBeInTheDocument();
  expect(tasks.counts).toHaveBeenCalledOnce();
  expect(tasks.list).toHaveBeenCalledOnce();
});

it('shows team tasks and marks one complete after a server response', async () => {
  choices();
  vi.spyOn(tasks, 'list').mockResolvedValue({ count: 1, next: null, previous: null, results: [task] });
  const update = vi.spyOn(tasks, 'update').mockResolvedValue({ ...task, status: 'done', completed_at: '2026-11-12T13:00:00Z' });
  render(<TasksPage user={user} />);
  await userEvent.click(screen.getByRole('button', { name: /^Team/ }));
  expect(await screen.findByText('Send brief')).toBeInTheDocument();
  expect(screen.getByText(/Sam Parker/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Complete' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith('task-1', { status: 'done' }));
  expect(await screen.findByText('Task completed.')).toBeInTheDocument();
});

it('filters tasks by client and deal and opens the editor from the list', async () => {
  choices();
  const list = vi.spyOn(tasks, 'list').mockResolvedValue({ count: 1, next: null, previous: null, results: [task] });
  render(<TasksPage user={user} search="brief" />);
  await screen.findByRole('button', { name: 'Send brief' });
  await userEvent.selectOptions(screen.getByLabelText('Filter tasks by client'), 'client-1');
  await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: 'brief', client: 'client-1' }), expect.any(AbortSignal)));
  await userEvent.click(screen.getByRole('button', { name: 'Actions for Send brief' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit task' }));
  expect(screen.getByRole('heading', { name: 'Edit task' })).toBeInTheDocument();
});

it('completes and reopens a task using the row action', async () => {
  choices();
  let current = task;
  vi.spyOn(tasks, 'list').mockImplementation(async () => ({ count: 1, next: null, previous: null, results: [current] }));
  const update = vi.spyOn(tasks, 'update').mockImplementation(async (_id, changes) => {
    current = { ...current, ...changes };
    return current;
  });
  render(<TasksPage user={user} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Complete' }));
  expect(await screen.findByText('Task completed.')).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
  expect(await screen.findByText('Task reopened.')).toBeInTheDocument();
  expect(update).toHaveBeenLastCalledWith(task.id, { status: 'open' });
});

it('confirms deletion and refreshes tasks and counters after success', async () => {
  choices();
  let deleted = false;
  vi.mocked(tasks.counts).mockImplementation(async () => ({ mine: deleted ? 0 : 1, team: deleted ? 0 : 1, overdue: 0, upcoming: 0, done: 0 }));
  vi.spyOn(tasks, 'list').mockImplementation(async () => ({ count: deleted ? 0 : 1, next: null, previous: null, results: deleted ? [] : [task] }));
  const remove = vi.spyOn(tasks, 'remove').mockImplementation(async () => { deleted = true; });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const onCountChanged = vi.fn();
  render(<TasksPage user={user} onCountChanged={onCountChanged} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Send brief' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete task' }));
  expect(remove).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole('button', { name: 'Actions for Send brief' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete task' }));
  expect(await screen.findByText('Task deleted.')).toBeInTheDocument();
  expect(await screen.findByText('No tasks in this view.')).toBeInTheDocument();
  expect(remove).toHaveBeenCalledWith(task.id);
  expect(onCountChanged).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'My tasks 0' })).toBeInTheDocument();
});

it('closes task actions with Escape and preserves the task when deletion fails', async () => {
  choices();
  vi.spyOn(tasks, 'list').mockResolvedValue({ count: 1, next: null, previous: null, results: [task] });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(tasks, 'remove').mockRejectedValue(new Error('Unable to delete the task.'));
  render(<TasksPage user={user} />);
  const trigger = await screen.findByRole('button', { name: 'Actions for Send brief' });
  await userEvent.click(trigger);
  await userEvent.keyboard('{Escape}');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Delete task' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to delete the task.');
  expect(screen.getByRole('button', { name: 'Send brief' })).toBeInTheDocument();
});

it('opens a task by ID even when it is outside the first list page', async () => {
  choices();
  window.location.hash = '#/tasks?task=task-1';
  vi.spyOn(tasks, 'list').mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  const detail = vi.spyOn(tasks, 'detail').mockResolvedValue(task);
  render(<TasksPage user={user} />);
  expect(await screen.findByRole('heading', { name: 'Edit task' })).toBeInTheDocument();
  expect(detail).toHaveBeenCalledWith('task-1', expect.any(AbortSignal));
  window.location.hash = '';
});

it('brings the linked task editor into view on a narrow screen', async () => {
  choices();
  window.location.hash = '#/tasks?task=task-1';
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  vi.spyOn(tasks, 'list').mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  vi.spyOn(tasks, 'detail').mockResolvedValue(task);
  const scroll = vi.fn();
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  try {
    render(<TasksPage user={user} />);
    expect(await screen.findByRole('heading', { name: 'Edit task' })).toBeInTheDocument();
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'start' }));
    expect(screen.getByLabelText('Title')).toHaveValue(task.title);
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});


it('retries failed choices without losing edits and restores the assigned member', async () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  choices();
  vi.mocked(workspace.settings).mockRejectedValueOnce(new Error('Unavailable'));
  vi.spyOn(tasks, 'list').mockResolvedValue({ count: 1, next: null, previous: null, results: [task] });
  const update = vi.spyOn(tasks, 'update').mockResolvedValue(task);
  render(<TasksPage user={user} />);
  await screen.findByRole('button', { name: 'Retry task choices' });
  const title = await screen.findByLabelText('Title');
  await userEvent.clear(title);
  await userEvent.type(title, 'Keep this unsaved title');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Retry task choices' }));
  await waitFor(() => expect(screen.getByLabelText('Assignee')).toHaveValue('2'));
  expect(title).toHaveValue('Keep this unsaved title');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(task.id, expect.objectContaining({ title: 'Keep this unsaved title', assignee: 2 })));
});
