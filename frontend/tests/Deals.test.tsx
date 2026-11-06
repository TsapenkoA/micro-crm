import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import DealsPage from '../src/features/deals/DealsPage';
import DealForm from '../src/features/deals/DealForm';
import { ApiError } from '../src/api/client';
import { date, deals, money, type Deal } from '../src/features/deals/api';
import type { Client } from '../src/features/clients/api';

const drag = vi.hoisted(() => ({ end: null as null | ((event: { active: { id: string }; over: { id: string } }) => void) }));
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: typeof drag.end }) => { drag.end = onDragEnd; return <div>{children}</div>; },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), setActivatorNodeRef: vi.fn(), isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensors: vi.fn(), useSensor: vi.fn(), PointerSensor: vi.fn(), KeyboardSensor: vi.fn(),
}));
vi.mock('../src/features/deals/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/features/deals/api')>();
  return { ...actual, deals: { list: vi.fn(), clients: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), status: vi.fn(), remove: vi.fn() } };
});

const client: Client = { id: 'client-1', workspace: 'company-1', created_by: 1, name: 'Alex Client', company: 'Studio', email: 'alex@example.com', phone: '', created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z' };
const deal: Deal = { id: 'deal-1', title: 'Website project', client: client.id, status: 'new_lead', amount: '1234.56', currency: 'EUR', deadline: '2026-12-01T12:00:00Z', version: 1, outcome: 'none', paid_at: null, created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z' };

beforeEach(() => {
  vi.resetAllMocks();
  drag.end = null;
  vi.mocked(deals.list).mockResolvedValue({ results: [deal], totals: [{ status: 'new_lead', currency: 'EUR', count: 1, amount: '1234.56' }] });
  vi.mocked(deals.clients).mockResolvedValue([client]);
  vi.mocked(deals.detail).mockResolvedValue(deal);
});

it('renders all five stages, exact money, server totals and the table from real API DTOs', async () => {
  render(<DealsPage />);
  expect(await screen.findByRole('button', { name: 'Open Website project' })).toBeInTheDocument();
  for (const name of ['New Lead', 'Negotiation', 'In Progress', 'Paid', 'Archived']) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  expect(screen.getAllByText('1,234.56 EUR')).toHaveLength(3);
  await userEvent.click(screen.getByRole('button', { name: /Table/ }));
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Website project' })).toBeInTheDocument();
  expect(money('9999999999999999.99', 'USD')).toBe('9,999,999,999,999,999.99 USD');
  expect(money('9800.00', 'USD')).toBe('9,800 USD');
  expect(money('9800.50', 'USD')).toBe('9,800.50 USD');
});

it('opens preview-style live details with English dates, real fields and client notes navigation', async () => {
  render(<DealsPage />);
  const trigger = await screen.findByRole('button', { name: 'Open Website project' });
  await userEvent.click(trigger);
  const details = await screen.findByRole('complementary', { name: 'Deal details' });
  expect(within(details).getByText('DEAL DETAILS')).toBeInTheDocument();
  expect(within(details).getByRole('heading', { name: 'Website project' })).toBeInTheDocument();
  expect(within(details).getByText('Dec 1, 2026')).toBeInTheDocument();
  expect(within(details).queryByText('Created by')).not.toBeInTheDocument();
  await userEvent.click(within(details).getByRole('button', { name: 'Notes' }));
  expect(within(details).getByText('Notes are saved on the client record and shared with your company.')).toBeInTheDocument();
  expect(within(details).getByRole('button', { name: 'Open client notes' })).toBeInTheDocument();
  await userEvent.click(within(details).getByRole('button', { name: 'Close deal details' }));
  expect(screen.queryByRole('complementary', { name: 'Deal details' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(date(deal.deadline)).toBe('Dec 1, 2026');
});

it('submits search explicitly, preserves filters across views and refreshes colleagues changes', async () => {
  render(<DealsPage />);
  await screen.findByText('Website project');
  await userEvent.type(screen.getByLabelText('Search deals'), 'Website');
  expect(deals.list).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(deals.list).toHaveBeenLastCalledWith({ search: 'Website', status: '', currency: '' }, expect.any(AbortSignal)));
  await userEvent.selectOptions(screen.getByLabelText('Filter by currency'), 'EUR');
  await waitFor(() => expect(deals.list).toHaveBeenLastCalledWith({ search: 'Website', status: '', currency: 'EUR' }, expect.any(AbortSignal)));
  await userEvent.click(screen.getByRole('button', { name: /Table/ }));
  expect(screen.getByLabelText('Filter by currency')).toHaveValue('EUR');
  vi.mocked(deals.list).mockResolvedValue({ results: [{ ...deal, title: 'Colleague update' }], totals: [] });
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Colleague update')).toBeInTheDocument();
});

it('validates a form, saves a string amount and refetches after create', async () => {
  vi.mocked(deals.create).mockResolvedValue({ ...deal, title: 'New project' });
  render(<DealsPage />);
  await screen.findByText('Website project');
  await userEvent.click(screen.getByRole('button', { name: '+ New deal' }));
  const dialog = screen.getByRole('dialog', { name: 'New deal' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create deal' }));
  expect(deals.create).not.toHaveBeenCalled();
  expect(within(dialog).getByText('Enter a deal title.')).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Deal title'), 'New project');
  await userEvent.selectOptions(within(dialog).getByLabelText('Client'), client.id);
  await userEvent.type(within(dialog).getByLabelText('Amount'), '120.50');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create deal' }));
  await waitFor(() => expect(deals.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'New project', amount: '120.50', client: client.id, deadline: null })));
  expect(await screen.findByText('Deal saved.')).toBeInTheDocument();
  expect(deals.list).toHaveBeenCalledTimes(2);
});

it('chooses a deadline from an English calendar and submits a timezone-qualified value', async () => {
  vi.mocked(deals.create).mockResolvedValue(deal);
  render(<DealForm clients={[client]} onCancel={vi.fn()} onPending={vi.fn()} onSaved={vi.fn()} />);
  const picker = screen.getByRole('button', { name: 'Deadline (local time)' });
  await userEvent.click(picker);
  const calendar = screen.getByRole('dialog', { name: 'Choose deadline' });
  expect(within(calendar).getByText('Mon')).toBeInTheDocument();
  expect(within(calendar).getByText(new Date().toLocaleString('en-US', { month: 'long' }), { exact: false })).toBeInTheDocument();
  await userEvent.click(within(calendar).getByRole('button', { name: 'Today' }));
  await userEvent.click(within(calendar).getByRole('button', { name: 'Done' }));
  expect(picker).toHaveTextContent(new Date().toLocaleString('en-US', { month: 'long' }));
  await userEvent.type(screen.getByLabelText('Deal title'), 'Scheduled work');
  await userEvent.selectOptions(screen.getByLabelText('Client'), client.id);
  await userEvent.type(screen.getByLabelText('Amount'), '250');
  await userEvent.click(screen.getByRole('button', { name: 'Create deal' }));
  await waitFor(() => expect(deals.create).toHaveBeenCalledWith(expect.objectContaining({ deadline: expect.stringMatching(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) })));
});

it('retains a stale edit draft and requires an explicit discard after comparing latest data', async () => {
  vi.mocked(deals.update).mockRejectedValue(new ApiError(409, 'Conflict'));
  vi.mocked(deals.detail).mockResolvedValue({ ...deal, title: 'Colleague edit', version: 2 });
  const saved = vi.fn();
  render(<DealForm initial={{ ...deal, amount: '9800.00' }} clients={[client]} onCancel={vi.fn()} onPending={vi.fn()} onSaved={saved} />);
  expect(screen.getByLabelText('Amount')).toHaveValue('9800');
  await userEvent.clear(screen.getByLabelText('Deal title'));
  await userEvent.type(screen.getByLabelText('Deal title'), 'My unsaved edit');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('updated elsewhere');
  expect(screen.getByLabelText('Deal title')).toHaveValue('My unsaved edit');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Reload current' }));
  expect(await screen.findByText('Latest server record · version 2')).toBeInTheDocument();
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Deal title')).toHaveValue('My unsaved edit');
  await userEvent.click(screen.getByRole('button', { name: 'Discard draft and open latest' }));
  expect(saved).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
});

it.each([409, 403, 500])('rolls back a failed drag with status %s and keeps the error after refetch', async code => {
  vi.mocked(deals.status).mockRejectedValue(new ApiError(code, 'Request failed'));
  render(<DealsPage />);
  await screen.findByText('Website project');
  await act(async () => drag.end!({ active: { id: deal.id }, over: { id: 'paid' } }));
  await waitFor(() => expect(deals.status).toHaveBeenCalledWith(deal, 'paid', 'none'));
  expect(await screen.findByRole('alert')).toHaveTextContent(code === 409 ? 'updated elsewhere' : 'Request failed');
  await screen.findByText('Website project');
  expect(within(screen.getByRole('region', { name: 'New Lead' })).getByText('Website project')).toBeInTheDocument();
  expect(deals.list).toHaveBeenCalledTimes(2);
});

it('persists a successful drag and refreshes authoritative totals', async () => {
  const paid: Deal = { ...deal, status: 'paid', version: 2, paid_at: '2026-11-04T12:00:00Z' };
  vi.mocked(deals.status).mockResolvedValue(paid);
  render(<DealsPage />);
  await screen.findByText('Website project');
  vi.mocked(deals.list).mockResolvedValue({ results: [paid], totals: [{ status: 'paid', currency: 'EUR', count: 1, amount: '1234.56' }] });
  await act(async () => drag.end!({ active: { id: deal.id }, over: { id: 'paid' } }));
  await screen.findByText('Deal status updated.');
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Paid' })).getByText('Website project')).toBeInTheDocument());
  expect(within(screen.getByRole('region', { name: 'Paid' })).getByText('1,234.56 EUR', { selector: '.deal-column-totals span' })).toBeInTheDocument();
});

it('confirms deletion with the current version and preserves the record after cancellation', async () => {
  vi.mocked(deals.remove).mockResolvedValue(undefined);
  render(<DealsPage />);
  await screen.findByText('Website project');
  await userEvent.click(screen.getByRole('button', { name: /Table/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete Website project' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
  expect(deals.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Delete Website project' }));
  vi.mocked(deals.list).mockResolvedValue({ results: [], totals: [] });
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm deletion' }));
  expect(await screen.findByText('Deal deleted.')).toBeInTheDocument();
  expect(deals.remove).toHaveBeenCalledWith(deal);
});
