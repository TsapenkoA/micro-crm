import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { workspace } from '../src/api/client';
import InvoicesPage from '../src/features/invoices/InvoicesPage';
import InvoiceForm from '../src/features/invoices/InvoiceForm';
import { invoices, type Invoice, type InvoiceListItem } from '../src/features/invoices/api';
import { deals } from '../src/features/deals/api';
import { clients as clientApi } from '../src/features/clients/api';

vi.mock('../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/client')>();
  return {
    ...actual,
    workspace: {
      ...actual.workspace,
      bankDetails: vi.fn(),
      sellerDetails: vi.fn(),
    },
  };
});
vi.mock('../src/features/invoices/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/invoices/api')>();
  return {
    ...actual,
    invoices: {
      page: vi.fn(),
      summary: vi.fn(),
      list: vi.fn(),
      detail: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      status: vi.fn(),
      payment: vi.fn(),
      voidPayment: vi.fn(),
      correctDueDate: vi.fn(),
      cancel: vi.fn(),
      send: vi.fn(),
      reminderPreview: vi.fn(),
      remind: vi.fn(),
      pdf: vi.fn(),
    },
  };
});
vi.mock('../src/features/deals/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/deals/api')>();
  return { ...actual, deals: { ...actual.deals, clients: vi.fn(), list: vi.fn() } };
});
vi.mock('../src/features/clients/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/clients/api')>();
  return { ...actual, clients: { ...actual.clients, detail: vi.fn() } };
});

const client = {
  id: 'client-1',
  workspace: 'workspace-1',
  created_by: 1,
  name: 'Client',
  company: 'Studio',
  email: 'client@example.test',
  phone: '',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};
const record: Invoice = {
  id: 'invoice-1',
  invoice_number: 'INV-000001',
  client: client.id,
  deal: null,
  currency: 'USD',
  status: 'draft',
  seller_snapshot: { name: 'Workspace', email: 'seller@example.test' },
  buyer_snapshot: { name: client.name, company: client.company, email: client.email },
  items: [
    {
      id: 1,
      position: 0,
      description: 'Design service',
      quantity: '1.000',
      unit_price: '100.0000',
      tax_rate: '20.0000',
      line_total: '100.00',
      tax_amount: '20.00',
    },
  ],
  subtotal: '100.00',
  tax_total: '20.00',
  total_amount: '120.00',
  payments: [],
  paid_amount: '0.00',
  balance_due: '120.00',
  overdue: false,
  deliveries: [],
  due_date_corrections: [],
  issued_at: null,
  due_date: null,
  payment_terms: '',
  paid_at: null,
  cancelled_at: null,
  cancellation_reason: '',
  created_at: '2026-01-01',
};
const listItem = (invoice: Invoice): InvoiceListItem => ({
  id: invoice.id,
  invoice_number: invoice.invoice_number,
  client: invoice.client,
  deal: invoice.deal,
  client_name: invoice.buyer_snapshot.name || '',
  client_company: invoice.buyer_snapshot.company || '',
  description: invoice.items[0]?.description || '',
  currency: invoice.currency,
  status: invoice.status,
  issued_at: invoice.issued_at,
  due_date: invoice.due_date,
  total_amount: invoice.total_amount,
  overdue: invoice.overdue,
  needs_due_date: invoice.status === 'sent' && !invoice.due_date,
  created_at: invoice.created_at,
});
let invoiceData: Invoice[] = [record];

beforeEach(() => {
  vi.resetAllMocks();
  invoiceData = [record];
  vi.mocked(deals.clients).mockResolvedValue([client]);
  vi.mocked(deals.list).mockResolvedValue({ results: [], totals: [] });
  vi.mocked(workspace.sellerDetails).mockResolvedValue({ name: 'Workspace', email: 'seller@example.test' });
  vi.mocked(workspace.bankDetails).mockResolvedValue({});
  vi.mocked(clientApi.detail).mockResolvedValue({ ...client, deals: [], contacts: [], bank_details: {} });
  vi.mocked(invoices.list).mockResolvedValue([listItem(record)]);
  vi.mocked(invoices.detail).mockResolvedValue(record);
  vi.mocked(invoices.page).mockImplementation(async (_search, _status, currency, page = 1) => {
    const rows = invoiceData.filter((invoice) => invoice.currency === currency);
    return {
      count: rows.length,
      results: rows.slice((page - 1) * 20, page * 20).map(listItem),
      next: page * 20 < rows.length ? 'next' : null,
      previous: page > 1 ? 'previous' : null,
    };
  });
  vi.mocked(invoices.summary).mockImplementation(async (currency) => {
    const rows = invoiceData.filter((invoice) => invoice.currency === currency);
    const totals = {
      sent: { count: 0, amount: '0' },
      paid: { count: 0, amount: '0' },
      draft: { count: 0, amount: '0' },
      overdue: { count: 0, amount: '0' },
    };
    for (const invoice of rows) {
      const status = invoice.overdue ? 'overdue' : invoice.status;
      if (status !== 'sent' && status !== 'paid' && status !== 'draft' && status !== 'overdue') continue;
      const bucket = totals[status];
      bucket.count += 1;
      bucket.amount = (
        Number(bucket.amount) +
        Number(
          status === 'paid' ? invoice.paid_amount : status === 'overdue' ? invoice.balance_due : invoice.total_amount,
        )
      ).toFixed(2);
    }
    return { currency, ...totals };
  });
  vi.mocked(invoices.create).mockResolvedValue(record);
});

it('lists saved invoices and shows authoritative details', async () => {
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  await userEvent.click(await screen.findByRole('button', { name: 'INV-000001' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Design service')).toBeInTheDocument();
  expect(within(dialog).getAllByText('120 USD').length).toBeGreaterThan(0);
  expect(within(dialog).getByRole('button', { name: 'Issue without email' })).toBeInTheDocument();
});

it('starts with the preferred currency and explains a currency-filtered empty list', async () => {
  invoiceData = [{ ...record, currency: 'EUR' }];
  render(
    <InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" reportingCurrency="GBP" totalCount={1} />,
  );
  expect(await screen.findByText('No invoices match GBP.')).toBeInTheDocument();
  expect(screen.queryByText('No invoices yet. Create a draft to get started.')).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Summary currency'), 'EUR');
  expect(await screen.findByRole('button', { name: 'INV-000001' })).toBeInTheDocument();
});

it('switches the list to the currency of a newly saved invoice', async () => {
  vi.mocked(invoices.create).mockImplementation(async () => {
    const created = { ...record, id: 'eur-invoice', invoice_number: 'INV-EUR-1', currency: 'EUR' };
    invoiceData.push(created);
    return created;
  });
  const view = render(
    <InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" createRequested totalCount={1} />,
  );
  const editor = await screen.findByRole('dialog', { name: 'New invoice' });
  view.rerender(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" totalCount={1} />);
  await userEvent.selectOptions(within(editor).getByLabelText('Client'), client.id);
  await userEvent.selectOptions(within(editor).getByLabelText('Currency'), 'EUR');
  await userEvent.type(within(editor).getByLabelText('Description'), 'European project');
  await userEvent.type(within(editor).getByLabelText('Unit price'), '100');
  await userEvent.click(within(editor).getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Invoice created.');
  expect(screen.getByLabelText('Summary currency')).toHaveValue('EUR');
  expect(await screen.findByRole('button', { name: 'INV-EUR-1' })).toBeInTheDocument();
});

it('clears search and status filters after creating an invoice', async () => {
  invoiceData = [];
  const created = { ...record, id: 'new-invoice', invoice_number: 'INV-NEW-1' };
  vi.mocked(invoices.create).mockImplementation(async () => {
    invoiceData.push(created);
    return created;
  });
  const onCreateHandled = vi.fn();
  const view = render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" totalCount={1} />);

  await screen.findByText(/No invoices match USD/);
  await userEvent.click(screen.getByRole('button', { name: 'Sent' }));
  await userEvent.type(screen.getByLabelText('Search invoices'), 'missing');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() =>
    expect(invoices.page).toHaveBeenLastCalledWith('missing', 'sent', 'USD', 1, expect.any(AbortSignal)),
  );

  view.rerender(
    <InvoicesPage
      workspaceName="Workspace"
      userEmail="seller@example.test"
      totalCount={1}
      createRequested
      onCreateHandled={onCreateHandled}
    />,
  );
  const editor = await screen.findByRole('dialog', { name: 'New invoice' });
  view.rerender(
    <InvoicesPage
      workspaceName="Workspace"
      userEmail="seller@example.test"
      totalCount={1}
      onCreateHandled={onCreateHandled}
    />,
  );
  await userEvent.selectOptions(within(editor).getByLabelText('Client'), client.id);
  await userEvent.type(within(editor).getByLabelText('Description'), 'New work');
  await userEvent.type(within(editor).getByLabelText('Unit price'), '100');
  await userEvent.click(within(editor).getByRole('button', { name: 'Save draft' }));

  expect(await screen.findByRole('button', { name: 'INV-NEW-1' })).toBeInTheDocument();
  expect(screen.getByLabelText('Search invoices')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'All invoices' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(invoices.page).toHaveBeenLastCalledWith('', '', 'USD', 1, expect.any(AbortSignal)));
});

it('paginates invoice rows while keeping the workspace summary', async () => {
  vi.mocked(invoices.page).mockImplementation(async (_search, _status, _currency, page = 1) => ({
    count: 21,
    results: [{ ...listItem(record), id: `invoice-${page}`, invoice_number: `INV-00000${page}` }],
    next: page === 1 ? 'next' : null,
    previous: page > 1 ? 'previous' : null,
  }));
  vi.mocked(invoices.summary).mockResolvedValue({
    currency: 'USD',
    sent: { count: 0, amount: '0.00' },
    paid: { count: 0, amount: '0.00' },
    draft: { count: 21, amount: '2520.00' },
    overdue: { count: 0, amount: '0.00' },
  });
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  expect(await screen.findByRole('button', { name: 'INV-000001' })).toBeInTheDocument();
  expect(screen.getByText('$2,520')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('button', { name: 'INV-000002' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'INV-000001' })).not.toBeInTheDocument();
  expect(screen.getByText('$2,520')).toBeInTheDocument();
  expect(invoices.page).toHaveBeenLastCalledWith('', '', 'USD', 2, expect.any(AbortSignal));
});

it('selects a client deal for a draft and links back to its details', async () => {
  const linkedDeal = { id: 'deal-1', title: 'Website project', client: client.id } as Awaited<
    ReturnType<typeof deals.detail>
  >;
  vi.mocked(deals.list).mockResolvedValue({ results: [linkedDeal], totals: [] });
  vi.mocked(invoices.create).mockResolvedValue({ ...record, deal: linkedDeal.id });
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" createRequested />);
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Client'), client.id);
  await within(dialog).findByRole('option', { name: 'Website project' });
  await userEvent.selectOptions(within(dialog).getByLabelText('Deal (optional)'), linkedDeal.id);
  await userEvent.type(within(dialog).getByLabelText('Description'), 'Design');
  await userEvent.type(within(dialog).getByLabelText('Unit price'), '100');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
  expect(invoices.create).toHaveBeenCalledWith(expect.objectContaining({ client: client.id, deal: linkedDeal.id }));
  await userEvent.click(await screen.findByRole('button', { name: 'Website project →' }));
  expect(window.location.hash).toBe('#/deals?deal=deal-1');
  window.location.hash = '/invoices';
});

it('shows the saved bank snapshots in invoice details', async () => {
  vi.mocked(invoices.detail).mockResolvedValue({
    ...record,
    seller_snapshot: { ...record.seller_snapshot, bank_details: { iban: 'DE89370400440532013000' } },
    buyer_snapshot: { ...record.buyer_snapshot, bank_details: { account_number: '12345678' } },
  });
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  await userEvent.click(await screen.findByRole('button', { name: 'INV-000001' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('IBAN: DE89370400440532013000')).toBeInTheDocument();
  expect(within(dialog).getByText('Account number: 12345678')).toBeInTheDocument();
});

it('creates a draft, refetches the list, and shows server validation', async () => {
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" createRequested />);
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Client'), client.id);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
  expect(within(dialog).getByText('Enter a description.')).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Description'), 'Design');
  await userEvent.selectOptions(within(dialog).getByLabelText('Currency'), 'GBP');
  await userEvent.type(within(dialog).getByLabelText('Unit price'), '100');
  await userEvent.clear(within(dialog).getByLabelText('Tax %'));
  await userEvent.type(within(dialog).getByLabelText('Tax %'), '20');
  expect(within(within(dialog).getByLabelText('Invoice preview')).getByText('120 GBP')).toBeInTheDocument();
  vi.mocked(invoices.create).mockRejectedValueOnce(
    new ApiError(400, 'Invalid input', { items: [{ tax_rate: ['Invalid tax rate.'] }] }),
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
  expect(await within(dialog).findByText('Invalid tax rate.')).toBeInTheDocument();
  const taxRate = within(dialog).getByLabelText('Tax %');
  expect(taxRate).toHaveAttribute('aria-invalid', 'true');
  expect(document.getElementById(taxRate.getAttribute('aria-describedby')!)).toHaveTextContent('Invalid tax rate.');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(invoices.create).toHaveBeenCalledTimes(2));
  expect(invoices.create).toHaveBeenLastCalledWith(expect.objectContaining({ currency: 'GBP' }));
  expect(vi.mocked(invoices.create).mock.lastCall?.[0].seller).toBeUndefined();
  expect(await screen.findByText('Invoice created.')).toBeInTheDocument();
  expect(invoices.page).toHaveBeenCalledTimes(2);
});

it('previews a complete invoice document and does not preselect a client', async () => {
  render(
    <InvoiceForm
      clients={[client]}
      deals={[]}
      workspaceName="Workspace"
      userEmail="seller@example.test"
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onPending={vi.fn()}
    />,
  );
  const clientSelect = screen.getByLabelText('Client');
  const preview = screen.getByLabelText('Invoice preview');

  expect(clientSelect).toHaveValue('');
  expect(within(preview).getByText('Choose a client')).toBeInTheDocument();
  expect(within(preview).queryByText(client.email)).not.toBeInTheDocument();

  await userEvent.selectOptions(clientSelect, client.id);
  await userEvent.type(screen.getByLabelText('Description'), 'Annual support');
  await userEvent.type(screen.getByLabelText('Unit price'), '100');
  await userEvent.clear(screen.getByLabelText('Tax %'));
  await userEvent.type(screen.getByLabelText('Tax %'), '20');
  await userEvent.type(screen.getByLabelText('Due date'), '2026-12-15');
  await userEvent.type(screen.getByLabelText('Payment terms'), 'Due within 14 days');

  expect(within(preview).getByText(client.email)).toBeInTheDocument();
  expect(within(preview).getByText('Studio')).toBeInTheDocument();
  expect(within(preview).getByText('Due: Dec 15, 2026')).toBeInTheDocument();
  expect(within(preview).getByText('Payment terms: Due within 14 days')).toBeInTheDocument();
  expect(within(preview).getByRole('row', { name: /Annual support/ })).toHaveTextContent('100 USD');
  expect(within(preview).getByText('120 USD')).toBeInTheDocument();
});

it('previews saved workspace seller, workspace bank, and selected client bank details', async () => {
  vi.mocked(workspace.sellerDetails).mockResolvedValue({
    name: 'Acme Legal Ltd',
    email: 'billing@acme.example',
    phone: '+1 555 0100',
    address: '10 Main Street',
    tax_id: 'TAX-123',
  });
  vi.mocked(workspace.bankDetails).mockResolvedValue({
    account_holder: 'Acme Legal Ltd',
    bank_name: 'Workspace Bank',
    iban: 'DE89370400440532013000',
  });
  vi.mocked(clientApi.detail).mockResolvedValue({
    ...client,
    deals: [],
    contacts: [],
    bank_details: { account_holder: 'Studio Ltd', bank_name: 'Client Bank', iban: 'GB82WEST12345698765432' },
  });

  render(
    <InvoiceForm
      clients={[client]}
      deals={[]}
      workspaceName="Workspace"
      userEmail="seller@example.test"
      isWorkspaceOwner
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onPending={vi.fn()}
    />,
  );
  const preview = screen.getByLabelText('Invoice preview');

  expect(await within(preview).findByText('Acme Legal Ltd')).toBeInTheDocument();
  expect(within(preview).getByText('billing@acme.example')).toBeInTheDocument();
  expect(within(preview).getByText(/Workspace Bank/)).toBeInTheDocument();
  expect(within(preview).getByText(/IBAN.*DE89370400440532013000/)).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('Client'), client.id);
  expect(await within(preview).findByText(/Client Bank/)).toBeInTheDocument();
  expect(within(preview).getByText(/IBAN.*GB82WEST12345698765432/)).toBeInTheDocument();
});

it('does not request owner-only workspace details for a non-owner', () => {
  render(
    <InvoiceForm
      clients={[client]}
      deals={[]}
      workspaceName="Workspace"
      userEmail="seller@example.test"
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onPending={vi.fn()}
    />,
  );

  expect(workspace.sellerDetails).not.toHaveBeenCalled();
  expect(workspace.bankDetails).not.toHaveBeenCalled();
  expect(
    screen.getByText('Only the workspace owner can preview saved seller and workspace bank details.'),
  ).toBeInTheDocument();
});

it('explains recent-auth requirements and offers Security when workspace details are protected', async () => {
  vi.mocked(workspace.sellerDetails).mockRejectedValue(new ApiError(403, 'Forbidden'));
  vi.mocked(workspace.bankDetails).mockRejectedValue(new ApiError(403, 'Forbidden'));
  const onOpenSecurity = vi.fn();

  render(
    <InvoiceForm
      clients={[client]}
      deals={[]}
      workspaceName="Workspace"
      userEmail="seller@example.test"
      isWorkspaceOwner
      onOpenSecurity={onOpenSecurity}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onPending={vi.fn()}
    />,
  );
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Confirm your identity in Settings > Security');
  await userEvent.click(within(alert).getByRole('button', { name: 'Open Security in a new tab' }));
  expect(onOpenSecurity).toHaveBeenCalledOnce();
});

it('previews invoice amounts with the selected currency precision', async () => {
  render(
    <InvoiceForm
      clients={[client]}
      deals={[]}
      workspaceName="Workspace"
      userEmail="seller@example.test"
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onPending={vi.fn()}
    />,
  );
  await userEvent.type(screen.getByLabelText('Description'), 'Service');
  await userEvent.type(screen.getByLabelText('Unit price'), '100.4999');
  const preview = screen.getByLabelText('Invoice preview');
  await userEvent.selectOptions(screen.getByLabelText('Currency'), 'JPY');
  expect(within(preview).getAllByText('100 JPY')).toHaveLength(3);
  await userEvent.selectOptions(screen.getByLabelText('Currency'), 'PLN');
  expect(within(preview).getAllByText('100.50 PLN')).toHaveLength(3);
});

it('preserves invoice details if PDF generation fails', async () => {
  vi.mocked(invoices.pdf).mockRejectedValue(new Error('PDF unavailable'));
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  await userEvent.click(await screen.findByRole('button', { name: 'INV-000001' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download PDF' }));
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('PDF unavailable');
  expect(within(screen.getByRole('dialog')).getByText('Design service')).toBeInTheDocument();
});

it('shows currency-specific status totals and keeps search with the status buttons', async () => {
  const eur: Invoice = {
    ...record,
    id: 'invoice-2',
    invoice_number: 'INV-000002',
    currency: 'EUR',
    status: 'paid',
    total_amount: '200.00',
    paid_amount: '200.00',
    balance_due: '0.00',
  };
  const pln: Invoice = {
    ...record,
    id: 'invoice-3',
    invoice_number: 'INV-000003',
    currency: 'PLN',
    status: 'paid',
    total_amount: '125.50',
    paid_amount: '125.50',
    balance_due: '0.00',
  };
  invoiceData = [record, eur, pln];
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  expect(await screen.findByText('$120')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'INV-000001' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'INV-000002' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Summary currency'), 'EUR');
  expect(screen.getByText('€200')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'INV-000002' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'INV-000001' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Summary currency'), 'PLN');
  expect(screen.getAllByText('125.50 PLN')).toHaveLength(2);
  await userEvent.selectOptions(screen.getByLabelText('Summary currency'), 'EUR');
  await userEvent.click(screen.getByRole('button', { name: 'Paid', pressed: false }));
  await waitFor(() => expect(invoices.page).toHaveBeenCalledWith('', 'paid', 'EUR', 1, expect.any(AbortSignal)));
  await userEvent.type(screen.getByLabelText('Search invoices'), 'Studio');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(invoices.page).toHaveBeenCalledWith('Studio', 'paid', 'EUR', 1, expect.any(AbortSignal)));
  expect(screen.getByText('€200')).toBeInTheDocument();
});

it('records a partial payment and shows the remaining overdue balance', async () => {
  const overdue: Invoice = {
    ...record,
    status: 'sent',
    due_date: '2020-01-10',
    issued_at: '2020-01-01',
    overdue: true,
  };
  const updated: Invoice = {
    ...overdue,
    paid_amount: '40.00',
    balance_due: '80.00',
    payments: [
      {
        id: 'payment-1',
        amount: '40.00',
        received_on: '2020-01-11',
        reference: 'Transfer',
        is_legacy: false,
        created_at: '2020-01-11',
        voided_at: null,
        voided_by: null,
        void_reason: '',
      },
    ],
  };
  invoiceData = [overdue];
  vi.mocked(invoices.detail).mockResolvedValue(overdue);
  vi.mocked(invoices.payment).mockResolvedValue(updated);
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  await userEvent.click(await screen.findByRole('button', { name: 'INV-000001' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Overdue')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
  await userEvent.clear(within(dialog).getByLabelText('Amount (USD)'));
  await userEvent.type(within(dialog).getByLabelText('Amount (USD)'), '40');
  await userEvent.type(within(dialog).getByLabelText('Reference (optional)'), 'Transfer');
  await userEvent.click(within(dialog).getAllByRole('button', { name: 'Record payment' })[1]);
  await waitFor(() => expect(invoices.payment).toHaveBeenCalledWith('invoice-1', '40', expect.any(String), 'Transfer'));
  expect(await within(dialog).findByText('80 USD')).toBeInTheDocument();
  expect(within(dialog).getByText(/Transfer/)).toBeInTheDocument();
});

it('requires review before a reminder and confirms email delivery explicitly', async () => {
  const overdue: Invoice = { ...record, status: 'sent', due_date: '2020-01-10', overdue: true };
  invoiceData = [overdue];
  vi.mocked(invoices.detail).mockResolvedValue(overdue);
  vi.mocked(invoices.reminderPreview).mockResolvedValue({
    subject: 'Payment reminder',
    body: 'Please pay the invoice.',
    can_send: true,
    reason: '',
  });
  vi.mocked(invoices.remind).mockResolvedValue({
    ...overdue,
    deliveries: [
      {
        id: 'delivery-1',
        kind: 'reminder',
        result: 'accepted',
        recipient: client.email,
        attempted_at: '2026-11-12T12:00:00Z',
        resolved_at: null,
        resolution_reason: '',
      },
    ],
  });
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  await userEvent.click(await screen.findByRole('button', { name: 'INV-000001' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Review reminder' }));
  expect(await within(dialog).findByText('Please pay the invoice.')).toBeInTheDocument();
  expect(invoices.remind).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Send reminder' }));
  await waitFor(() => expect(invoices.remind).toHaveBeenCalledWith('invoice-1'));
  expect(await within(dialog).findByText(/Accepted by mail server/)).toBeInTheDocument();
});

it('flags a sent invoice without a due date and records a visible correction', async () => {
  const undated: Invoice = { ...record, status: 'sent', issued_at: '2026-01-01T00:00:00Z' };
  invoiceData = [undated];
  vi.mocked(invoices.detail).mockResolvedValue(undated);
  vi.mocked(invoices.correctDueDate).mockResolvedValue({
    ...undated,
    due_date: '2026-12-15',
    due_date_corrections: [
      {
        id: 'correction-1',
        previous_due_date: null,
        due_date: '2026-12-15',
        reason: 'Agreed payment date',
        corrected_by: 1,
        created_at: '2026-11-16T12:00:00Z',
      },
    ],
  });
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  expect(await screen.findByText('Needs due date')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'INV-000001' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Correct due date' }));
  await userEvent.type(within(dialog).getByLabelText('Due date'), '2026-12-15');
  await userEvent.type(within(dialog).getByLabelText('Reason'), 'Agreed payment date');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
  expect(invoices.correctDueDate).toHaveBeenCalledWith('invoice-1', '2026-12-15', 'Agreed payment date');
  expect(await within(dialog).findByText(/Agreed payment date/)).toBeInTheDocument();
});

it('reverses a recorded payment without removing its history', async () => {
  const paid: Invoice = {
    ...record,
    status: 'paid',
    paid_at: '2026-01-02T00:00:00Z',
    paid_amount: '120.00',
    balance_due: '0.00',
    payments: [
      {
        id: 'payment-1',
        amount: '120.00',
        received_on: '2026-01-02',
        reference: 'Transfer',
        is_legacy: false,
        created_at: '2026-01-02T00:00:00Z',
        voided_at: null,
        voided_by: null,
        void_reason: '',
      },
    ],
  };
  invoiceData = [paid];
  vi.mocked(invoices.detail).mockResolvedValue(paid);
  vi.mocked(invoices.voidPayment).mockResolvedValue({
    ...paid,
    status: 'sent',
    paid_at: null,
    paid_amount: '0.00',
    balance_due: '120.00',
    payments: [
      { ...paid.payments[0], voided_at: '2026-11-16T12:00:00Z', voided_by: 1, void_reason: 'Duplicate receipt' },
    ],
  });
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  await userEvent.click(await screen.findByRole('button', { name: 'INV-000001' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse' }));
  await userEvent.type(within(dialog).getByLabelText('Reason'), 'Duplicate receipt');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm reversal' }));
  expect(invoices.voidPayment).toHaveBeenCalledWith('invoice-1', 'payment-1', 'Duplicate receipt');
  expect(await within(dialog).findByText(/Reversed: Duplicate receipt/)).toBeInTheDocument();
});
