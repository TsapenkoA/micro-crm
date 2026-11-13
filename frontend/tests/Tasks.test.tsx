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

afterEach(() => vi.restoreAllMocks());

function choices() {
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

it('shows team tasks and marks one complete after a server response', async () => {
  choices();
  vi.spyOn(tasks, 'list').mockResolvedValue({ count: 1, next: null, previous: null, results: [task] });
  const update = vi.spyOn(tasks, 'update').mockResolvedValue({ ...task, status: 'done', completed_at: '2026-11-12T13:00:00Z' });
  render(<TasksPage user={user} />);
  await userEvent.click(screen.getByRole('button', { name: 'Team' }));
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
  await userEvent.click(screen.getByRole('button', { name: 'Edit Send brief' }));
  expect(screen.getByRole('heading', { name: 'Edit task' })).toBeInTheDocument();
});
