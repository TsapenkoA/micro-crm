import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RelatedTasks from '../src/features/tasks/RelatedTasks';
import { tasks, type Task } from '../src/features/tasks/api';

afterEach(() => vi.restoreAllMocks());

it('shows only linked tasks and opens the exact task', async () => {
  const row: Task = {
    id: 'task-1',
    client: 'client-1',
    client_name: 'Client',
    deal: 'deal-1',
    deal_title: 'Deal',
    title: 'Send proposal',
    assignee: 1,
    assignee_name: 'Alex',
    due_at: '2026-11-20T12:00:00Z',
    status: 'open',
    completed_at: null,
    created_by: 1,
    created_at: '',
    updated_at: '',
  };
  const list = vi.spyOn(tasks, 'list').mockResolvedValue({ count: 1, next: null, previous: null, results: [row] });
  render(<RelatedTasks clientId="client-1" dealId="deal-1" />);
  expect(await screen.findByRole('link', { name: 'Send proposal' })).toHaveAttribute('href', '#/tasks?task=task-1');
  expect(list).toHaveBeenCalledWith({ client: 'client-1', deal: 'deal-1', page: 1 }, expect.any(AbortSignal));
  expect(screen.getByRole('link', { name: /Add task/ })).toHaveAttribute(
    'href',
    '#/tasks?new=1&client=client-1&deal=deal-1',
  );
});

it('saves completion and filters related tasks on the server', async () => {
  const { fireEvent, waitFor } = await import('@testing-library/react');
  const row = {
    id: 'task-2',
    client: 'client-1',
    deal: 'deal-1',
    title: 'Review proposal',
    due_at: '2026-11-20T12:00:00Z',
    status: 'open',
  } as Task;
  const list = vi.spyOn(tasks, 'list').mockResolvedValue({ count: 1, next: null, previous: null, results: [row] });
  const update = vi.spyOn(tasks, 'update').mockResolvedValue({ ...row, status: 'done' });
  render(<RelatedTasks clientId="client-1" dealId="deal-1" />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Review proposal' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith('task-2', { status: 'done' }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter related tasks' }), { target: { value: 'done' } });
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith(
      { client: 'client-1', deal: 'deal-1', page: 1, status: 'done' },
      expect.any(AbortSignal),
    ),
  );
});
