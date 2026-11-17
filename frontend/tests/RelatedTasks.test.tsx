import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RelatedTasks from '../src/features/tasks/RelatedTasks';
import { tasks, type Task } from '../src/features/tasks/api';

afterEach(() => vi.restoreAllMocks());

it('shows only linked tasks and opens the exact task', async () => {
  const row: Task = { id: 'task-1', client: 'client-1', client_name: 'Client', deal: 'deal-1', deal_title: 'Deal', title: 'Send proposal', assignee: 1, assignee_name: 'Alex', due_at: '2026-11-20T12:00:00Z', status: 'open', completed_at: null, created_by: 1, created_at: '', updated_at: '' };
  const list = vi.spyOn(tasks, 'list').mockResolvedValue({ count: 1, next: null, previous: null, results: [row] });
  render(<RelatedTasks clientId="client-1" dealId="deal-1" />);
  expect(await screen.findByRole('link', { name: 'Send proposal' })).toHaveAttribute('href', '#/tasks?task=task-1');
  expect(list).toHaveBeenCalledWith({ client: 'client-1', deal: 'deal-1', page: 1 }, expect.any(AbortSignal));
  expect(screen.getByRole('link', { name: 'New task →' })).toHaveAttribute('href', '#/tasks?new=1&client=client-1&deal=deal-1');
});
