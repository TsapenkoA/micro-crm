import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import DealsPage from '../src/features/deals/DealsPage';
import DealForm from '../src/features/deals/DealForm';
import { ApiError } from '../src/api/client';
import { date, deals, money, type Deal } from '../src/features/deals/api';
import type { Client } from '../src/features/clients/api';
import { invoices, type InvoiceListItem } from '../src/features/invoices/api';
import { activity } from '../src/features/activity/api';
import { tasks } from '../src/features/tasks/api';

const drag = vi.hoisted(() => ({
  end: null as null | ((event: { active: { id: string }; over: { id: string } }) => void),
}));
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: typeof drag.end }) => {
    drag.end = onDragEnd;
    return <div>{children}</div>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensors: vi.fn(),
  useSensor: vi.fn(),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
}));
vi.mock('../src/features/deals/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/deals/api')>();
  return {
    ...actual,
    deals: {
      page: vi.fn(),
      list: vi.fn(),
      clients: vi.fn(),
      detail: vi.fn(),
      notes: vi.fn(),
      addNote: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      status: vi.fn(),
      remove: vi.fn(),
    },
  };
});
vi.mock('../src/features/activity/api', () => ({ activity: { list: vi.fn() } }));
vi.mock('../src/features/tasks/api', () => ({ tasks: { list: vi.fn() } }));
vi.mock('../src/features/invoices/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/invoices/api')>();
  return { ...actual, invoices: { ...actual.invoices, list: vi.fn() } };
});

const client: Client = {
  id: 'client-1',
  workspace: 'company-1',
  created_by: 1,
  name: 'Alex Client',
  company: 'Studio',
  email: 'alex@example.com',
  phone: '',
  created_at: '2026-01-01T12:00:00Z',
  updated_at: '2026-01-01T12:00:00Z',
};
const deal: Deal = {
  id: 'deal-1',
  title: 'Website project',
  client: client.id,
  status: 'new_lead',
  amount: '1234.56',
  currency: 'EUR',
  deadline: '2026-12-01T12:00:00Z',
  version: 1,
  outcome: 'none',
  paid_at: null,
  created_at: '2026-01-01T12:00:00Z',
  updated_at: '2026-01-01T12:00:00Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  drag.end = null;
  vi.mocked(deals.list).mockResolvedValue({
    results: [deal],
    totals: [{ status: 'new_lead', currency: 'EUR', count: 1, amount: '1234.56' }],
  });
  vi.mocked(deals.page).mockImplementation(async (filters, _page, _ordering, signal) => {
    const result = await deals.list(filters, signal);
    return { ...result, count: result.results.length, next: null, previous: null };
  });
  vi.mocked(deals.clients).mockResolvedValue([client]);
  vi.mocked(deals.detail).mockResolvedValue(deal);
  vi.mocked(invoices.list).mockResolvedValue([]);
  vi.mocked(deals.notes).mockResolvedValue({ count: 0, results: [], next: null, previous: null });
  vi.mocked(tasks.list).mockResolvedValue({ count: 0, results: [], next: null, previous: null });
  vi.mocked(activity.list).mockResolvedValue({ count: 0, results: [], next: null, previous: null });
});

it('shows linked invoices on a deal and opens the invoice route', async () => {
  const linked = {
    id: 'invoice-1',
    invoice_number: 'INV-000001',
    total_amount: '120.00',
    currency: 'EUR',
    status: 'sent',
    overdue: false,
  } as InvoiceListItem;
  vi.mocked(invoices.list).mockResolvedValue([linked]);
  render(<DealsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open Website project' }));
  const details = await screen.findByRole('dialog', { name: 'Deal details' });
  await userEvent.click(within(details).getByRole('button', { name: /Invoices/ }));
  await userEvent.click(await within(details).findByRole('button', { name: 'INV-000001 · 120 EUR →' }));
  expect(invoices.list).toHaveBeenCalledWith('', '', expect.any(AbortSignal), deal.id);
  expect(window.location.hash).toBe('#/invoices?invoice=invoice-1');
  window.location.hash = '/deals';
});

it('renders all five stages, exact money, server totals and the table from real API DTOs', async () => {
  render(<DealsPage />);
  expect(await screen.findByRole('button', { name: 'Open Website project' })).toBeInTheDocument();
  for (const name of ['New Lead', 'Negotiation', 'In Progress', 'Paid', 'Archived'])
    expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  expect(screen.getAllByText('1,234.56 EUR')).toHaveLength(2);
  expect(screen.getByText('Choose a currency to see pipeline totals')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Filter by currency'), 'EUR');
  expect(screen.getAllByText('1,234.56 EUR')).toHaveLength(3);
  await userEvent.click(screen.getByRole('button', { name: /Table/ }));
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Website project' })).toBeInTheDocument();
  expect(money('9999999999999999.99', 'USD')).toBe('9,999,999,999,999,999.99 USD');
  expect(money('9800.00', 'USD')).toBe('9,800 USD');
  expect(money('9800.50', 'USD')).toBe('9,800.50 USD');
});

it('keeps multiple column currencies separate and collapsed until requested', async () => {
  const usdDeal = { ...deal, id: 'deal-usd', title: 'USD project', amount: '500.00', currency: 'USD' };
  vi.mocked(deals.list).mockResolvedValue({
    results: [deal, usdDeal],
    totals: [
      { status: 'new_lead', currency: 'EUR', count: 1, amount: '1234.56' },
      { status: 'new_lead', currency: 'USD', count: 1, amount: '500.00' },
    ],
  });
  render(<DealsPage />);
  const column = await screen.findByRole('region', { name: 'New Lead' });
  const summary = within(column).getByText('Totals in 2 currencies');
  const totalsDetails = summary.closest('details')!;
  expect(within(totalsDetails).getByRole('list')).toBeInTheDocument();
  expect(within(totalsDetails).getAllByRole('listitem')).toHaveLength(2);
  expect(within(totalsDetails).getByText('1,234.56 EUR')).not.toBeVisible();
  expect(within(totalsDetails).getByText('500 USD')).not.toBeVisible();
  await userEvent.click(summary);
  expect(within(totalsDetails).getByText('1,234.56 EUR')).toBeVisible();
  expect(within(totalsDetails).getByText('500 USD')).toBeVisible();
});

it('loads another board page only on request and keeps server totals', async () => {
  vi.mocked(deals.page).mockImplementation(async (_filters, page = 1) => ({
    count: 21,
    results: page === 1 ? [deal] : [{ ...deal, id: 'deal-2', title: 'Second page project' }],
    next: page === 1 ? 'next' : null,
    previous: page > 1 ? 'previous' : null,
    totals: [{ status: 'new_lead', currency: 'EUR', count: 21, amount: '2100.00' }],
  }));
  render(<DealsPage />);
  expect(await screen.findByRole('button', { name: 'Open Website project' })).toBeInTheDocument();
  expect(deals.page).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Load more deals (1 of 21)' }));
  expect(await screen.findByRole('button', { name: 'Open Second page project' })).toBeInTheDocument();
  expect(deals.page).toHaveBeenLastCalledWith(
    { search: '', status: '', currency: '' },
    2,
    'newest',
    expect.any(AbortSignal),
  );
});

it('keeps the loaded board through repeated status changes, editing and deletion', async () => {
  let rows = Array.from({ length: 21 }, (_, index) => ({
    ...deal,
    id: `loaded-${index}`,
    title: `Loaded deal ${index + 1}`,
  }));
  vi.mocked(deals.page).mockImplementation(async (_filters, page = 1) => ({
    count: rows.length,
    results: rows.slice((page - 1) * 20, page * 20),
    next: page * 20 < rows.length ? 'next' : null,
    previous: page > 1 ? 'previous' : null,
    totals: [],
  }));
  vi.mocked(deals.detail).mockImplementation(async (id) => rows.find((row) => row.id === id)!);
  vi.mocked(deals.status).mockImplementation(async (current, status) => {
    const updated = { ...current, status, version: current.version + 1 };
    rows = rows.map((row) => (row.id === updated.id ? updated : row));
    return updated;
  });
  vi.mocked(deals.update).mockImplementation(async (current, values) => {
    const updated = { ...current, ...values, version: current.version + 1 };
    rows = rows.map((row) => (row.id === updated.id ? updated : row));
    return updated;
  });
  vi.mocked(deals.remove).mockImplementation(async (current) => {
    rows = rows.filter((row) => row.id !== current.id);
  });
  render(<DealsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Load more deals (20 of 21)' }));
  await screen.findByRole('button', { name: 'Open Loaded deal 21' });
  await act(async () => drag.end!({ active: { id: 'loaded-20' }, over: { id: 'in_progress' } }));
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'In Progress' })).getByRole('button', { name: 'Open Loaded deal 21' }),
    ).not.toBeDisabled(),
  );
  await waitFor(() => expect(screen.queryByText('Refreshing deals…')).not.toBeInTheDocument());
  await act(async () => drag.end!({ active: { id: 'loaded-20' }, over: { id: 'paid' } }));
  expect(deals.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'loaded-20', version: 2 }),
    'paid',
    'none',
  );
  await waitFor(() => expect(screen.queryByText('Refreshing deals…')).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Open Loaded deal 21' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Edit deal' }));
  await userEvent.clear(screen.getByLabelText('Deal title'));
  await userEvent.type(screen.getByLabelText('Deal title'), 'Updated older deal');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Deal saved.');
  await waitFor(() => expect(screen.queryByText('Refreshing deals…')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Open Updated older deal' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Delete deal' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm deletion' }));
  await screen.findByText('Deal deleted.');
  await waitFor(() => expect(screen.queryByText('Refreshing deals…')).not.toBeInTheDocument());
  expect(screen.getAllByRole('button', { name: /^Open Loaded deal/ })).toHaveLength(20);
  expect(document.body.style.overflow).toBe('');
}, 15000);

it('shows a status conflict inside deal details', async () => {
  vi.mocked(deals.status).mockRejectedValue(new ApiError(409, 'Conflict', undefined, 'version_conflict'));
  render(<DealsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open Website project' }));
  const dialog = await screen.findByRole('dialog', { name: 'Deal details' });
  await userEvent.selectOptions(await within(dialog).findByLabelText('Change status'), 'paid');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('updated elsewhere');
  expect(within(dialog).getByRole('button', { name: 'Reload current' })).toBeInTheDocument();
});

it('does not offer version reload for a protected deletion', async () => {
  vi.mocked(deals.remove).mockRejectedValue(
    new ApiError(409, 'This deal has related records and cannot be deleted.', undefined, 'protected'),
  );
  render(<DealsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open Website project' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Delete deal' }));
  const dialog = screen.getByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm deletion' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('related records');
  expect(within(dialog).queryByRole('button', { name: 'Reload current' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Confirm deletion' })).toBeDisabled();
});

it('opens compact deal details over the unchanged Kanban and navigates its sections', async () => {
  render(<DealsPage />);
  const trigger = await screen.findByRole('button', { name: 'Open Website project' });
  await userEvent.click(trigger);
  const details = await screen.findByRole('dialog', { name: 'Deal details' });
  expect(screen.getByRole('heading', { name: 'New Lead' })).toBeInTheDocument();
  expect(document.querySelector('.live-deal-layout')).not.toHaveClass('with-detail');
  expect(within(details).getByRole('heading', { name: 'Website project' })).toBeInTheDocument();
  expect(within(details).getByText('1,234.56 EUR')).toBeInTheDocument();
  expect(within(details).getByText('Dec 1, 2026')).toBeInTheDocument();
  expect(within(details).getByText('Deadline')).toBeInTheDocument();
  expect(within(details).getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
  expect(within(details).getByRole('button', { name: 'Edit deal' })).toBeInTheDocument();
  expect(within(details).getByRole('button', { name: 'Delete deal' })).toBeInTheDocument();
  expect(within(details).queryByText('Created by')).not.toBeInTheDocument();
  await userEvent.click(within(details).getByRole('button', { name: /^Notes/ }));
  expect(within(details).getByText('Shared with your company and visible on the client record.')).toBeInTheDocument();
  expect(within(details).getByRole('textbox', { name: 'New note' })).toBeInTheDocument();
  await userEvent.click(within(details).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Deal details' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(date(deal.deadline)).toBe('Dec 1, 2026');
});

it('adds a deal note and refreshes its notes and activity', async () => {
  const note = {
    id: 'note-1',
    client: client.id,
    text: 'Confirm the scope.',
    deal: deal.id,
    author: { id: 1, username: 'admin' },
    created_at: '2026-11-01T12:00:00Z',
    can_delete: true,
  };
  vi.mocked(deals.addNote).mockResolvedValue(note);
  vi.mocked(deals.notes)
    .mockResolvedValueOnce({ count: 0, results: [], next: null, previous: null })
    .mockResolvedValue({ count: 1, results: [note], next: null, previous: null });
  render(<DealsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open Website project' }));
  const details = await screen.findByRole('dialog', { name: 'Deal details' });
  await userEvent.click(within(details).getByRole('button', { name: /^Notes/ }));
  await userEvent.type(within(details).getByRole('textbox', { name: 'New note' }), note.text);
  await userEvent.click(within(details).getByRole('button', { name: 'Add note' }));
  await waitFor(() => expect(deals.addNote).toHaveBeenCalledWith(deal.id, note.text));
  expect(await within(details).findByText(note.text)).toBeInTheDocument();
  expect(activity.list).toHaveBeenCalledWith(1, 'deal', undefined, '', '', '', deal.id);
});

it('submits search explicitly, preserves filters across views and refreshes colleagues changes', async () => {
  render(<DealsPage />);
  await screen.findByText('Website project');
  await userEvent.type(screen.getByLabelText('Search deals'), 'Website');
  expect(deals.page).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() =>
    expect(deals.page).toHaveBeenLastCalledWith(
      { search: 'Website', status: '', currency: '' },
      1,
      'newest',
      expect.any(AbortSignal),
    ),
  );
  await userEvent.selectOptions(screen.getByLabelText('Filter by currency'), 'EUR');
  await waitFor(() =>
    expect(deals.page).toHaveBeenLastCalledWith(
      { search: 'Website', status: '', currency: 'EUR' },
      1,
      'newest',
      expect.any(AbortSignal),
    ),
  );
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
  await waitFor(() =>
    expect(deals.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New project', amount: '120.50', client: client.id, deadline: null }),
    ),
  );
  expect(await screen.findByText('Deal saved.')).toBeInTheDocument();
  expect(deals.page).toHaveBeenCalledTimes(2);
});

it('chooses a deadline from an English calendar and submits a timezone-qualified value', async () => {
  vi.mocked(deals.create).mockResolvedValue(deal);
  render(<DealForm clients={[client]} onCancel={vi.fn()} onPending={vi.fn()} onSaved={vi.fn()} />);
  const picker = screen.getByRole('button', { name: 'Deadline (local time)' });
  await userEvent.click(picker);
  const calendar = screen.getByRole('dialog', { name: 'Choose deadline' });
  expect(within(calendar).getByText('Mon')).toBeInTheDocument();
  expect(
    within(calendar).getByText(new Date().toLocaleString('en-US', { month: 'long' }), { exact: false }),
  ).toBeInTheDocument();
  await userEvent.click(within(calendar).getByRole('button', { name: 'Today' }));
  await userEvent.click(within(calendar).getByRole('button', { name: 'Done' }));
  expect(picker).toHaveTextContent(new Date().toLocaleString('en-US', { month: 'long' }));
  await userEvent.type(screen.getByLabelText('Deal title'), 'Scheduled work');
  await userEvent.selectOptions(screen.getByLabelText('Client'), client.id);
  await userEvent.type(screen.getByLabelText('Amount'), '250');
  await userEvent.click(screen.getByRole('button', { name: 'Create deal' }));
  await waitFor(() =>
    expect(deals.create).toHaveBeenCalledWith(
      expect.objectContaining({ deadline: expect.stringMatching(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) }),
    ),
  );
});

it('retains a stale edit draft and requires an explicit discard after comparing latest data', async () => {
  vi.mocked(deals.update).mockRejectedValue(new ApiError(409, 'Conflict', undefined, 'version_conflict'));
  vi.mocked(deals.detail).mockResolvedValue({ ...deal, title: 'Colleague edit', version: 2 });
  const saved = vi.fn();
  const discarded = vi.fn();
  render(
    <DealForm
      initial={{ ...deal, amount: '9800.00' }}
      clients={[client]}
      onCancel={vi.fn()}
      onPending={vi.fn()}
      onSaved={saved}
      onDiscard={discarded}
    />,
  );
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
  expect(discarded).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
  expect(saved).not.toHaveBeenCalled();
});

it('only retries a conflict over a freshly loaded version after explicit confirmation', async () => {
  const latest = { ...deal, title: 'Colleague edit', version: 2 };
  vi.mocked(deals.detail).mockResolvedValue(latest);
  vi.mocked(deals.update)
    .mockRejectedValueOnce(new ApiError(409, 'Conflict', undefined, 'version_conflict'))
    .mockResolvedValueOnce({ ...latest, title: 'My draft', version: 3 });
  const saved = vi.fn();
  render(<DealForm initial={deal} clients={[client]} onCancel={vi.fn()} onPending={vi.fn()} onSaved={saved} />);
  await userEvent.clear(screen.getByLabelText('Deal title'));
  await userEvent.type(screen.getByLabelText('Deal title'), 'My draft');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Reload current' }));
  const retry = await screen.findByRole('button', { name: 'Save my changes over version 2' });
  expect(deals.update).toHaveBeenCalledTimes(1);
  await userEvent.click(retry);
  await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ title: 'My draft', version: 3 })));
  expect(deals.update).toHaveBeenLastCalledWith(latest, expect.objectContaining({ title: 'My draft' }));
});

it.each([409, 500])('rolls back a failed drag with status %s and keeps the error after refetch', async (code) => {
  vi.mocked(deals.status).mockRejectedValue(
    new ApiError(code, 'Request failed', undefined, code === 409 ? 'version_conflict' : undefined),
  );
  render(<DealsPage />);
  await screen.findByText('Website project');
  await act(async () => drag.end!({ active: { id: deal.id }, over: { id: 'paid' } }));
  await waitFor(() => expect(deals.status).toHaveBeenCalledWith(deal, 'paid', 'none'));
  expect(await screen.findByRole('alert')).toHaveTextContent(code === 409 ? 'updated elsewhere' : 'Request failed');
  await screen.findByText('Website project');
  expect(within(screen.getByRole('region', { name: 'New Lead' })).getByText('Website project')).toBeInTheDocument();
  expect(deals.page).toHaveBeenCalledTimes(2);
});

it('persists a successful drag and refreshes authoritative totals', async () => {
  const paid: Deal = { ...deal, status: 'paid', version: 2, paid_at: '2026-11-04T12:00:00Z' };
  vi.mocked(deals.status).mockResolvedValue(paid);
  render(<DealsPage />);
  await screen.findByText('Website project');
  await userEvent.selectOptions(screen.getByLabelText('Filter by currency'), 'EUR');
  vi.mocked(deals.list).mockResolvedValue({
    results: [paid],
    totals: [{ status: 'paid', currency: 'EUR', count: 1, amount: '1234.56' }],
  });
  await act(async () => drag.end!({ active: { id: deal.id }, over: { id: 'paid' } }));
  await screen.findByText('Deal status updated.');
  await waitFor(() =>
    expect(within(screen.getByRole('region', { name: 'Paid' })).getByText('Website project')).toBeInTheDocument(),
  );
  expect(
    within(screen.getByRole('region', { name: 'Paid' })).getByText('1,234.56 EUR', {
      selector: '.deal-column-totals span',
    }),
  ).toBeInTheDocument();
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

it('edits the deal description without changing shared notes', async () => {
  const initial = { ...deal, description: 'Original scope' };
  const updated = { ...initial, description: 'Revised scope', version: 2 };
  vi.mocked(deals.update).mockResolvedValue(updated);
  render(<DealForm initial={initial} clients={[client]} onSaved={vi.fn()} onCancel={vi.fn()} onPending={vi.fn()} />);
  await userEvent.clear(screen.getByLabelText('Description'));
  await userEvent.type(screen.getByLabelText('Description'), updated.description);
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(deals.update).toHaveBeenCalledWith(initial, expect.objectContaining({ description: updated.description })),
  );
  expect(deals.addNote).not.toHaveBeenCalled();
});

it('keeps a saved note committed when refreshing notes or activity fails', async () => {
  vi.mocked(deals.addNote).mockResolvedValue({
    id: 'new-note',
    client: client.id,
    deal: deal.id,
    author: { id: 1, username: 'admin' },
    text: 'Saved once',
    created_at: '2026-11-01T12:00:00Z',
    can_delete: true,
  });
  vi.mocked(deals.notes)
    .mockResolvedValueOnce({ count: 0, results: [], next: null, previous: null })
    .mockRejectedValueOnce(new Error('Refresh unavailable'))
    .mockResolvedValue({ count: 0, results: [], next: null, previous: null });
  render(<DealsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open Website project' }));
  const details = await screen.findByRole('dialog', { name: 'Deal details' });
  await userEvent.click(within(details).getByRole('button', { name: /^Notes/ }));
  await within(details).findByText('No notes for this deal yet.');
  vi.mocked(activity.list).mockRejectedValueOnce(new Error('Activity unavailable'));
  await userEvent.type(within(details).getByRole('textbox', { name: 'New note' }), 'Saved once');
  await userEvent.click(within(details).getByRole('button', { name: 'Add note' }));
  expect(await within(details).findByText('Note added.')).toBeInTheDocument();
  expect(within(details).getByRole('textbox', { name: 'New note' })).toHaveValue('');
  expect(within(details).getByRole('button', { name: 'Add note' })).toBeDisabled();
  await within(details).findByText('Note saved. Activity could not be refreshed.');
  await userEvent.click(await within(details).findByRole('button', { name: 'Retry notes' }));
  await within(details).findByText('No notes for this deal yet.');
  expect(deals.addNote).toHaveBeenCalledOnce();
});

it('opens older note pages and returns to the first page after adding a note', async () => {
  const note = {
    id: 'note-page',
    client: client.id,
    deal: deal.id,
    author: { id: 1, username: 'admin' },
    text: 'First page',
    created_at: '2026-11-01T12:00:00Z',
    can_delete: true,
  };
  vi.mocked(deals.notes).mockImplementation(async (_id, page = 1) => ({
    count: 21,
    results: [{ ...note, text: page === 1 ? 'First page' : 'Older note' }],
    next: page === 1 ? 'next' : null,
    previous: page === 2 ? 'previous' : null,
  }));
  vi.mocked(deals.addNote).mockResolvedValue(note);
  render(<DealsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open Website project' }));
  const details = await screen.findByRole('dialog', { name: 'Deal details' });
  await userEvent.click(within(details).getByRole('button', { name: /^Notes/ }));
  await within(details).findByText('First page');
  await userEvent.click(within(details).getByRole('button', { name: 'Next notes' }));
  expect(await within(details).findByText('Older note')).toBeInTheDocument();
  expect(deals.notes).toHaveBeenLastCalledWith(deal.id, 2, expect.any(AbortSignal));
  await userEvent.type(within(details).getByRole('textbox', { name: 'New note' }), 'New note');
  await userEvent.click(within(details).getByRole('button', { name: 'Add note' }));
  await within(details).findByText('First page');
  expect(within(details).getByText('21 notes · Page 1')).toBeInTheDocument();
});
