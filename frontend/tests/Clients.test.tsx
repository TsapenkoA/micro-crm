import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { ApiError, auth } from '../src/api/client';
import ClientsPage from '../src/features/clients/ClientsPage';
import ClientForm from '../src/features/clients/ClientForm';
import { clients, type Client, type ClientInput, type ClientPage } from '../src/features/clients/api';

const record: Client = { id: 'client-1', workspace: 'company-1', created_by: 1, name: 'Acme contact', company: 'Acme Studio', email: 'hello@example.com', phone: '+49 123', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
const page = (results: Client[] = []): ClientPage => ({ count: results.length, results, next: null, previous: null });

beforeEach(() => {
  vi.spyOn(clients, 'list').mockResolvedValue(page());
  vi.spyOn(clients, 'detail').mockResolvedValue({ ...record, deals: [] });
  vi.spyOn(clients, 'create').mockResolvedValue(record);
  vi.spyOn(clients, 'update').mockResolvedValue(record);
  vi.spyOn(clients, 'remove').mockResolvedValue(undefined);
  vi.spyOn(clients, 'notes').mockResolvedValue({ count: 0, results: [], next: null, previous: null });
  vi.spyOn(clients, 'links').mockResolvedValue({ count: 0, results: [], next: null, previous: null });
});
afterEach(() => vi.restoreAllMocks());

it('renders shared contacts with server deal counts and searches only on submit', async () => {
  vi.mocked(clients.list).mockResolvedValue(page([{ ...record, deal_count: 2 }]));
  render(<ClientsPage />);
  expect(await screen.findByRole('button', { name: record.name })).toBeInTheDocument();
  expect(screen.getByText(record.email)).toBeInTheDocument();
  expect(screen.getByText(record.phone)).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Deals' })).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox'), 'Acme');
  expect(clients.list).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(clients.list).toHaveBeenLastCalledWith('Acme', 1, expect.any(AbortSignal)));
});

it('requires a nonblank name and rejects malformed email without sending a request', async () => {
  const save = vi.fn();
  render(<ClientForm onSave={save} onCancel={vi.fn()} onPending={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  expect(screen.getByText('Enter a client name.')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Name'), '   ');
  await userEvent.type(screen.getByLabelText(/^Email/), 'invalid');
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it('includes payer bank details when saving a client', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ClientForm onSave={save} onCancel={vi.fn()} onPending={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Name'), 'Client');
  await userEvent.type(screen.getByLabelText('Account number'), '12345678');
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ bank_details: { account_number: '12345678' } })));
});

it('places server 400 messages under fields and preserves entered values', async () => {
  const save = vi.fn().mockRejectedValue(new ApiError(400, 'Validation failed.', { email: ['Enter a valid email address.'] }));
  render(<ClientForm onSave={save} onCancel={vi.fn()} onPending={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Name'), 'Keep my input');
  await userEvent.type(screen.getByLabelText(/^Email/), 'local@example');
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please correct the highlighted fields.');
  expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText(/^Email/)).toHaveAccessibleDescription('Enter a valid email address.');
  expect(screen.getByLabelText('Name')).toHaveValue('Keep my input');
});

it.each([new ApiError(403, 'Session expired.'), new ApiError(500, 'Server error.'), new Error('Network unavailable.')])('reports save errors without clearing the form: %s', async error => {
  render(<ClientForm onSave={vi.fn().mockRejectedValue(error)} onCancel={vi.fn()} onPending={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Name'), 'Unsaved contact');
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(error.message);
  expect(screen.getByLabelText('Name')).toHaveValue('Unsaved contact');
});

it('refetches after create and edit, then confirms a persisted deletion', async () => {
  vi.mocked(clients.list).mockResolvedValue(page([record]));
  render(<ClientsPage createRequested />);
  await screen.findByRole('button', { name: record.name });
  await screen.findByRole('dialog', { name: 'New client' });
  await userEvent.type(screen.getByLabelText('Name'), 'Created contact');
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  expect(await screen.findByText('Client created.')).toBeInTheDocument();
  expect(clients.create).toHaveBeenCalledWith({ name: 'Created contact', company: '', email: '', phone: '' });
  await waitFor(() => expect(clients.list).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole('button', { name: `Open ${record.name}` }));
  await userEvent.click(await screen.findByRole('button', { name: 'Edit client' }));
  await userEvent.clear(screen.getByLabelText('Name'));
  await userEvent.type(screen.getByLabelText('Name'), 'Edited contact');
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  expect(await screen.findByText('Client updated.')).toBeInTheDocument();
  expect(clients.update).toHaveBeenCalledWith(record.id, { name: 'Edited contact', company: record.company, email: record.email, phone: record.phone });
  await waitFor(() => expect(clients.list).toHaveBeenCalledTimes(3));
  await userEvent.click(screen.getByRole('button', { name: `Open ${record.name}` }));
  await userEvent.click(await screen.findByRole('button', { name: 'Delete client' }));
  expect(clients.remove).not.toHaveBeenCalled();
  vi.mocked(clients.list).mockResolvedValue(page());
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete client' }));
  expect(await screen.findByText('Client deleted.')).toBeInTheDocument();
  expect(clients.remove).toHaveBeenCalledWith(record.id);
  expect(await screen.findByText('No clients yet')).toBeInTheDocument();
});

it('keeps protected clients visible when deletion returns 409', async () => {
  vi.mocked(clients.list).mockResolvedValue(page([record]));
  vi.mocked(clients.remove).mockRejectedValue(new ApiError(409, 'Protected.'));
  render(<ClientsPage />);
  await userEvent.click(await screen.findByRole('button', { name: `Open ${record.name}` }));
  await userEvent.click(await screen.findByRole('button', { name: 'Delete client' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete client' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('invoices');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(clients.list).toHaveBeenCalledTimes(1);
});

it('opens real details, traps focus and restores focus after Escape', async () => {
  vi.mocked(clients.list).mockResolvedValue(page([record]));
  vi.mocked(clients.detail).mockResolvedValue({ ...record, deals: [{ id: 'deal-1', title: 'Brand project', amount: '123.45', currency: 'EUR', status: 'in_progress', deadline: null }] });
  render(<ClientsPage />);
  const trigger = await screen.findByRole('button', { name: record.name });
  await userEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Client details' });
  expect(document.body.style.overflow).toBe('hidden');
  expect(await within(dialog).findByText('Brand project')).toBeInTheDocument();
  expect(await within(dialog).findByText('No notes yet. Add the first update for your colleagues.')).toBeInTheDocument();
  expect(clients.detail).toHaveBeenCalledWith(record.id, expect.any(AbortSignal));
  await within(dialog).findByText('No links yet. Add a brief, design, or repository URL.');
  const lastButton = within(dialog).getByRole('button', { name: 'Add link' });
  lastButton.focus();
  expect(lastButton).toHaveFocus();
  await userEvent.tab();
  expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe('');
});

it.each(['light', 'dark'])('renders clients and the global create action in the %s theme', async theme => {
  localStorage.setItem('theme', theme);
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '+ New client' }));
  expect(document.documentElement).toHaveAttribute('data-theme', theme);
  expect(screen.getByRole('heading', { name: 'Clients', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'New client' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /View deals/ })).toBeEnabled();
});

it('shows a colleague’s newly created client after a fresh request and clears data across accounts', async () => {
  let currentUser = 'alice';
  const users = { alice: { id: 1, username: 'alice', email: '' }, bob: { id: 2, username: 'bob', email: '' }, outsider: { id: 3, username: 'outsider', email: '' } };
  const shared: Client[] = [];
  vi.spyOn(auth, 'me').mockResolvedValue({ user: users.alice });
  vi.spyOn(auth, 'logout').mockResolvedValue(undefined);
  vi.spyOn(auth, 'login').mockImplementation(async username => { currentUser = username; return users[username as keyof typeof users]; });
  vi.mocked(clients.list).mockImplementation(async () => page(currentUser === 'outsider' ? [] : [...shared]));
  vi.mocked(clients.create).mockImplementation(async (data: ClientInput) => { const created = { ...record, ...data }; shared.push(created); return created; });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '+ New client' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Company contact');
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  expect(await screen.findByRole('button', { name: 'Company contact' })).toBeInTheDocument();
  for (const username of ['bob', 'outsider']) {
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    await userEvent.type(screen.getByLabelText('Email or username'), username);
    await userEvent.type(screen.getByLabelText('Password'), 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    if (username === 'bob') {
      expect(await screen.findByRole('button', { name: 'Company contact' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(await screen.findByRole('button', { name: 'Company contact' })).toBeInTheDocument();
    } else {
      expect(await screen.findByText('No clients yet')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Company contact' })).not.toBeInTheDocument();
    }
  }
});
