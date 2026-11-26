import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import OperationsPage from '../src/features/operations/OperationsPage';
import { operations, type InvoiceDeliveryAttempt, type OperationsOverview } from '../src/features/operations/api';
import { tasks, type Task } from '../src/features/tasks/api';
import { invoices, type Invoice } from '../src/features/invoices/api';

afterEach(() => vi.restoreAllMocks());

const due: OperationsOverview = {
  today: {
    count: 2,
    results: [
      {
        kind: 'task',
        id: 'task-1',
        title: 'Review scope',
        subtitle: 'Client A',
        due_at: '2026-11-10T10:00:00Z',
        overdue: true,
      },
      { kind: 'invoice', id: 'invoice-1', title: 'INV-001', subtitle: 'Client A', due_at: '2026-11-10', overdue: true },
    ],
  },
  reminders: {
    count: 1,
    results: [
      { kind: 'invoice', id: 'invoice-1', title: 'INV-001', subtitle: 'Client A', due_at: '2026-11-10', overdue: true },
    ],
  },
  undated_invoices: { count: 0, results: [] },
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
  const preview = vi
    .spyOn(invoices, 'reminderPreview')
    .mockResolvedValue({ subject: 'Payment reminder', body: 'Please pay.', can_send: true, reason: '' });
  const remind = vi.spyOn(invoices, 'remind').mockResolvedValue({} as Invoice);
  render(<OperationsPage onCountChanged={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Shared deadlines 1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Review reminder' }));
  expect(preview).toHaveBeenCalledWith('invoice-1');
  expect(await screen.findByText('Please pay.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Send reminder email' }));
  expect(remind).toHaveBeenCalledWith('invoice-1');
  expect(await screen.findByText('Reminder accepted by the mail server.')).toBeInTheDocument();
});

it('shows a useful empty state without unavailable automation controls', async () => {
  vi.spyOn(operations, 'overview').mockResolvedValue({
    today: { count: 0, results: [] },
    reminders: { count: 0, results: [] },
    undated_invoices: { count: 0, results: [] },
  });
  render(<OperationsPage onCountChanged={vi.fn()} />);
  expect(await screen.findByText('No items on this page.')).toBeInTheDocument();
  expect(screen.queryByText('Automations')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Shared deadlines 0' }));
  expect(screen.getByText('No items on this page.')).toBeInTheDocument();
});

it('keeps invoices without due dates in a compact expandable list', async () => {
  vi.spyOn(operations, 'overview').mockResolvedValue({
    ...due,
    undated_invoices: { count: 1, results: [{ id: 'invoice-2', invoice_number: 'INV-002', client_name: 'Client B' }] },
  });
  render(<OperationsPage onCountChanged={vi.fn()} />);
  const heading = await screen.findByText('1 invoice needs a due date');
  const section = heading.closest('details');
  expect(section).not.toHaveAttribute('open');
  await userEvent.click(heading);
  expect(section).toHaveAttribute('open');
  expect(screen.getByRole('link', { name: 'INV-002 · Client B' })).toHaveAttribute(
    'href',
    '#/invoices?invoice=invoice-2',
  );
});

it('allows a platform administrator to resolve uncertain email outcomes with an audit reason', async () => {
  vi.spyOn(operations, 'overview').mockResolvedValue(due);
  const attempt: InvoiceDeliveryAttempt = {
    id: 'delivery-1',
    invoice_id: 'invoice-1',
    invoice_number: 'INV-001',
    workspace_name: 'Studio',
    kind: 'invoice',
    result: 'unknown',
    recipient: 'client@example.test',
    attempted_at: '2026-11-10T10:00:00Z',
  };
  const pending = vi
    .spyOn(operations, 'pendingDeliveries')
    .mockResolvedValueOnce({ count: 1, next: null, previous: null, results: [attempt] })
    .mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  const resolve = vi.spyOn(operations, 'resolveDelivery').mockResolvedValue({ ...attempt, result: 'failed' });
  render(<OperationsPage onCountChanged={vi.fn()} isPlatformAdmin />);
  expect(await screen.findByText('INV-001 · Invoice')).toBeInTheDocument();
  expect(screen.getByText(/may create a duplicate email/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Investigation reason'), 'Provider confirmed non-acceptance');
  await userEvent.click(screen.getByRole('button', { name: 'Resolve as failed (allow retry)' }));
  expect(resolve).toHaveBeenCalledWith('delivery-1', 'failed', 'Provider confirmed non-acceptance');
  expect(await screen.findByText(/Retrying is now allowed/)).toBeInTheDocument();
  expect(pending).toHaveBeenCalledTimes(2);
});
