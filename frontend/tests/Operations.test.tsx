import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import OperationsPage from '../src/features/operations/OperationsPage';
import { operations, type OperationsOverview } from '../src/features/operations/api';
import { tasks, type Task } from '../src/features/tasks/api';
import { invoices, type Invoice } from '../src/features/invoices/api';

afterEach(() => vi.restoreAllMocks());

const due: OperationsOverview = {
  today: { count: 2, results: [
    { kind: 'task', id: 'task-1', title: 'Review scope', subtitle: 'Client A', due_at: '2026-11-10T10:00:00Z', overdue: true },
    { kind: 'invoice', id: 'invoice-1', title: 'INV-001', subtitle: 'Client A', due_at: '2026-11-10', overdue: true },
  ] },
  reminders: { count: 1, results: [
    { kind: 'invoice', id: 'invoice-1', title: 'INV-001', subtitle: 'Client A', due_at: '2026-11-10', overdue: true },
  ] },
};

it('shows due work, completes a task and refreshes the overview', async () => {
  const overview = vi.spyOn(operations, 'overview').mockResolvedValue(due);
  const update = vi.spyOn(tasks, 'update').mockResolvedValue({} as Task);
  const counts = vi.fn();
  render(<OperationsPage onCountChanged={counts} />);
  expect(await screen.findByText('Review scope')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'INV-001' })).toHaveAttribute('href', '#/invoices?invoice=invoice-1');
  await userEvent.click(screen.getByRole('button', { name: 'Complete' }));
  expect(update).toHaveBeenCalledWith('task-1', { status: 'done' });
  expect(await screen.findByText('Task completed.')).toBeInTheDocument();
  expect(overview).toHaveBeenCalledTimes(2);
  expect(counts).toHaveBeenCalledOnce();
});

it('reviews the email before sending an overdue invoice reminder', async () => {
  vi.spyOn(operations, 'overview').mockResolvedValue(due);
  const preview = vi.spyOn(invoices, 'reminderPreview').mockResolvedValue({ subject: 'Payment reminder', body: 'Please pay.', can_send: true, reason: '' });
  const remind = vi.spyOn(invoices, 'remind').mockResolvedValue({} as Invoice);
  render(<OperationsPage onCountChanged={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Reminders 1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Review reminder' }));
  expect(preview).toHaveBeenCalledWith('invoice-1');
  expect(await screen.findByText('Please pay.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Send reminder email' }));
  expect(remind).toHaveBeenCalledWith('invoice-1');
  expect(await screen.findByText('Reminder accepted by the mail server.')).toBeInTheDocument();
});

it('shows a useful empty state without unavailable automation controls', async () => {
  vi.spyOn(operations, 'overview').mockResolvedValue({ today: { count: 0, results: [] }, reminders: { count: 0, results: [] } });
  render(<OperationsPage onCountChanged={vi.fn()} />);
  expect(await screen.findByText('Nothing needs your attention in the next seven days.')).toBeInTheDocument();
  expect(screen.queryByText('Automations')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reminders 0' }));
  expect(screen.getByText('No invoice or deal deadlines need a reminder.')).toBeInTheDocument();
});
