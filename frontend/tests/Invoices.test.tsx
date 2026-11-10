import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import InvoicesPage from '../src/features/invoices/InvoicesPage';
import InvoiceForm from '../src/features/invoices/InvoiceForm';
import { invoices, type Invoice } from '../src/features/invoices/api';
import { deals } from '../src/features/deals/api';

vi.mock('../src/features/invoices/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/features/invoices/api')>();
  return { ...actual, invoices: { list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), status: vi.fn(), pdf: vi.fn() } };
});
vi.mock('../src/features/deals/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/features/deals/api')>();
  return { ...actual, deals: { ...actual.deals, clients: vi.fn() } };
});

const client = { id: 'client-1', workspace: 'workspace-1', created_by: 1, name: 'Client', company: 'Studio', email: 'client@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' };
const record: Invoice = {
  id: 'invoice-1', invoice_number: 'INV-000001', client: client.id, currency: 'USD', status: 'draft',
  seller_snapshot: { name: 'Workspace', email: 'seller@example.test' }, buyer_snapshot: { name: client.name, company: client.company, email: client.email },
  items: [{ id: 1, position: 0, description: 'Design service', quantity: '1.000', unit_price: '100.0000', tax_rate: '20.0000', line_total: '100.00', tax_amount: '20.00' }],
  subtotal: '100.00', tax_total: '20.00', total_amount: '120.00', issued_at: null, paid_at: null, created_at: '2026-01-01',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(deals.clients).mockResolvedValue([client]);
  vi.mocked(invoices.list).mockResolvedValue([record]);
  vi.mocked(invoices.create).mockResolvedValue(record);
});

it('lists saved invoices and shows authoritative details', async () => {
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  await userEvent.click(await screen.findByRole('button', { name: 'INV-000001' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Design service')).toBeInTheDocument();
  expect(within(dialog).getByText('120 USD')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Mark as sent' })).toBeInTheDocument();
});

it('shows the saved bank snapshots in invoice details', async () => {
  vi.mocked(invoices.list).mockResolvedValue([{ ...record, seller_snapshot: { ...record.seller_snapshot, bank_details: { iban: 'DE89370400440532013000' } }, buyer_snapshot: { ...record.buyer_snapshot, bank_details: { account_number: '12345678' } } }]);
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" />);
  await userEvent.click(await screen.findByRole('button', { name: 'INV-000001' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('IBAN: DE89370400440532013000')).toBeInTheDocument();
  expect(within(dialog).getByText('Account number: 12345678')).toBeInTheDocument();
});

it('creates a draft, refetches the list, and shows server validation', async () => {
  render(<InvoicesPage workspaceName="Workspace" userEmail="seller@example.test" createRequested />);
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
  expect(within(dialog).getByText('Enter a description.')).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Description'), 'Design');
  await userEvent.selectOptions(within(dialog).getByLabelText('Currency'), 'GBP');
  await userEvent.type(within(dialog).getByLabelText('Unit price'), '100');
  await userEvent.clear(within(dialog).getByLabelText('Tax %'));
  await userEvent.type(within(dialog).getByLabelText('Tax %'), '20');
  expect(within(within(dialog).getByLabelText('Invoice preview')).getByText('120 GBP')).toBeInTheDocument();
  vi.mocked(invoices.create).mockRejectedValueOnce(new ApiError(400, 'Invalid input', { items: [{ tax_rate: ['Invalid tax rate.'] }] }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
  expect(await within(dialog).findByText('Invalid tax rate.')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(invoices.create).toHaveBeenCalledTimes(2));
  expect(invoices.create).toHaveBeenLastCalledWith(expect.objectContaining({ currency: 'GBP' }));
  expect(await screen.findByText('Invoice created.')).toBeInTheDocument();
  expect(invoices.list).toHaveBeenCalledTimes(2);
});

it('previews invoice amounts with the selected currency precision', async () => {
  render(<InvoiceForm clients={[client]} workspaceName="Workspace" userEmail="seller@example.test" onSave={vi.fn()} onCancel={vi.fn()} onPending={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Description'), 'Service');
  await userEvent.type(screen.getByLabelText('Unit price'), '100.4999');
  const preview = screen.getByLabelText('Invoice preview');
  await userEvent.selectOptions(screen.getByLabelText('Currency'), 'JPY');
  expect(within(preview).getAllByText('100 JPY')).toHaveLength(2);
  await userEvent.selectOptions(screen.getByLabelText('Currency'), 'PLN');
  expect(within(preview).getAllByText('100.50 PLN')).toHaveLength(2);
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
  const eur: Invoice = { ...record, id: 'invoice-2', invoice_number: 'INV-000002', currency: 'EUR', status: 'paid', total_amount: '200.00' };
  const pln: Invoice = { ...record, id: 'invoice-3', invoice_number: 'INV-000003', currency: 'PLN', status: 'paid', total_amount: '125.50' };
  vi.mocked(invoices.list).mockResolvedValue([record, eur, pln]);
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
  await waitFor(() => expect(invoices.list).toHaveBeenCalledWith('', 'paid', expect.any(AbortSignal)));
  await userEvent.type(screen.getByLabelText('Search invoices'), 'Studio');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(invoices.list).toHaveBeenCalledWith('Studio', 'paid', expect.any(AbortSignal)));
  expect(screen.getByText('€200')).toBeInTheDocument();
});
