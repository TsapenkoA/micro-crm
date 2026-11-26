import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { ApiError, auth } from '../src/api/client';
import ClientsPage from '../src/features/clients/ClientsPage';
import ClientForm from '../src/features/clients/ClientForm';
import { clients, type Client, type ClientInput, type ClientPage } from '../src/features/clients/api';

const record: Client = {
  id: 'client-1',
  workspace: 'company-1',
  created_by: 1,
  name: 'Acme contact',
  company: 'Acme Studio',
  email: 'hello@example.com',
  phone: '+49 123',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const page = (results: Client[] = []): ClientPage => ({ count: results.length, results, next: null, previous: null });

beforeEach(() => {
  vi.spyOn(clients, 'list').mockResolvedValue(page());
  vi.spyOn(clients, 'detail').mockResolvedValue({ ...record, deals: [], contacts: [] });
  vi.spyOn(clients, 'create').mockResolvedValue(record);
  vi.spyOn(clients, 'update').mockResolvedValue(record);
  vi.spyOn(clients, 'remove').mockResolvedValue(undefined);
  vi.spyOn(clients, 'notes').mockResolvedValue({ count: 0, results: [], next: null, previous: null });
  vi.spyOn(clients, 'links').mockResolvedValue({ count: 0, results: [], next: null, previous: null });
  vi.spyOn(clients, 'invoices').mockResolvedValue({ count: 0, results: [], next: null, previous: null });
  vi.spyOn(clients, 'contacts').mockResolvedValue([]);
  vi.spyOn(clients, 'attachments').mockResolvedValue({ count: 0, results: [], next: null, previous: null });
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
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ bank_details: { account_number: '12345678' } })),
  );
});

it('places server 400 messages under fields and preserves entered values', async () => {
  const save = vi
    .fn()
    .mockRejectedValue(new ApiError(400, 'Validation failed.', { email: ['Enter a valid email address.'] }));
  render(<ClientForm onSave={save} onCancel={vi.fn()} onPending={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Name'), 'Keep my input');
  await userEvent.type(screen.getByLabelText(/^Email/), 'local@example');
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please correct the highlighted fields.');
  expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText(/^Email/)).toHaveAccessibleDescription('Enter a valid email address.');
  expect(screen.getByLabelText('Name')).toHaveValue('Keep my input');
});

it.each([new ApiError(500, 'Server error.'), new Error('Network unavailable.')])(
  'reports save errors without clearing the form: %s',
  async (error) => {
    render(<ClientForm onSave={vi.fn().mockRejectedValue(error)} onCancel={vi.fn()} onPending={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Unsaved contact');
    await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(error.message);
    expect(screen.getByLabelText('Name')).toHaveValue('Unsaved contact');
  },
);

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
  expect(clients.update).toHaveBeenCalledWith(record.id, {
    name: 'Edited contact',
    company: record.company,
    email: record.email,
    phone: record.phone,
  });
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
  vi.mocked(clients.detail).mockResolvedValue({
    ...record,
    contacts: [],
    deals: [
      {
        id: 'deal-1',
        title: 'Brand project',
        amount: '123.45',
        currency: 'EUR',
        status: 'in_progress',
        deadline: null,
      },
    ],
  });
  render(<ClientsPage />);
  const trigger = await screen.findByRole('button', { name: record.name });
  await userEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Client details' });
  expect(document.body.style.overflow).toBe('hidden');
  expect(await within(dialog).findByText('Brand project')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: /^Notes(?: \d+)?$/ }));
  expect(
    await within(dialog).findByText('No notes yet. Add the first update for your colleagues.'),
  ).toBeInTheDocument();
  expect(clients.detail).toHaveBeenCalledWith(record.id, expect.any(AbortSignal));
  await userEvent.click(within(dialog).getByRole('button', { name: /^Links(?: \d+)?$/ }));
  await within(dialog).findByText('No links yet. Add a brief, design, or repository URL.');
  await userEvent.click(within(dialog).getByRole('button', { name: /^Files(?: \d+)?$/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add file' }));
  const lastControl = within(dialog).getByRole('button', { name: 'Choose file' });
  lastControl.focus();
  expect(lastControl).toHaveFocus();
  await userEvent.tab();
  expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe('');
});

it('keeps the seven overview cards compact and opens note editing only on request', async () => {
  vi.mocked(clients.list).mockResolvedValue(page([record]));
  render(<ClientsPage />);
  await userEvent.click(await screen.findByRole('button', { name: record.name }));
  const dialog = screen.getByRole('dialog', { name: 'Client details' });
  expect(dialog).not.toHaveClass('drawer');
  for (const section of ['deals', 'invoices', 'contacts', 'tasks', 'notes', 'links', 'files']) {
    expect(within(dialog).getByRole('region', { name: `${section} preview` })).toBeInTheDocument();
  }
  for (const section of ['Invoices', 'Notes', 'Links', 'Files']) {
    expect(await within(dialog).findByRole('button', { name: `${section} 0` })).toBeInTheDocument();
  }
  expect(within(dialog).queryByText('View all →')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('textbox', { name: 'New note' })).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Open notes' }));
  expect(within(dialog).getByRole('button', { name: /^Notes(?: \d+)?$/ })).toHaveAttribute('aria-current', 'page');
  expect(within(dialog).queryByRole('textbox', { name: 'New note' })).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
  expect(within(dialog).getByRole('textbox', { name: 'New note' })).toBeInTheDocument();
});

it('expands payer bank details on request', async () => {
  vi.mocked(clients.list).mockResolvedValue(page([record]));
  vi.mocked(clients.detail).mockResolvedValue({
    ...record,
    deals: [],
    contacts: [],
    bank_details: { bank_name: 'Example Bank' },
  });
  render(<ClientsPage />);
  await userEvent.click(await screen.findByRole('button', { name: record.name }));
  const dialog = screen.getByRole('dialog', { name: 'Client details' });
  const disclosure = within(dialog).getByText('Payer bank details').closest('details');
  expect(disclosure).toHaveProperty('open', false);
  await userEvent.click(within(dialog).getByText('Payer bank details'));
  expect(disclosure).toHaveProperty('open', true);
  expect(within(dialog).getByText('Example Bank')).toBeInTheDocument();
});

it('shows linked invoices and saves an additional primary contact', async () => {
  vi.mocked(clients.list).mockResolvedValue(page([record]));
  vi.mocked(clients.invoices).mockResolvedValue({
    count: 1,
    next: null,
    previous: null,
    results: [
      {
        id: 'invoice-1',
        invoice_number: 'INV-001',
        status: 'sent',
        currency: 'EUR',
        total_amount: '150.00',
        due_date: '2026-12-01',
        overdue: false,
      },
    ],
  });
  vi.spyOn(clients, 'addContact').mockResolvedValue({
    id: 'contact-2',
    client: record.id,
    name: 'Billing person',
    role: 'Finance',
    email: 'billing@example.com',
    phone: '',
    is_primary: true,
    created_at: '',
    updated_at: '',
  });
  render(<ClientsPage />);
  await userEvent.click(await screen.findByRole('button', { name: record.name }));
  const dialog = screen.getByRole('dialog', { name: 'Client details' });
  expect(await within(dialog).findByRole('link', { name: 'INV-001' })).toHaveAttribute(
    'href',
    '#/invoices?invoice=invoice-1',
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Contacts 0' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add contact' }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Billing person');
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Primary contact' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save contact' }));
  await waitFor(() =>
    expect(clients.addContact).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({ name: 'Billing person', is_primary: true }),
    ),
  );
});

it('edits a saved link and uploads a client file', async () => {
  vi.mocked(clients.list).mockResolvedValue(page([record]));
  vi.mocked(clients.links).mockResolvedValue({
    count: 1,
    next: null,
    previous: null,
    results: [{ id: 'link-1', client: record.id, label: 'Brief', url: 'https://example.com/brief', created_at: '' }],
  });
  vi.spyOn(clients, 'updateLink').mockResolvedValue({
    id: 'link-1',
    client: record.id,
    label: 'Updated brief',
    url: 'https://example.com/brief',
    created_at: '',
  });
  vi.spyOn(clients, 'addAttachment').mockResolvedValue({
    id: 'file-1',
    client: record.id,
    name: 'brief.pdf',
    content_type: 'application/pdf',
    size: 10,
    uploaded_by: 1,
    created_at: '',
  });
  render(<ClientsPage />);
  await userEvent.click(await screen.findByRole('button', { name: record.name }));
  const dialog = screen.getByRole('dialog', { name: 'Client details' });
  await userEvent.click(within(dialog).getByRole('button', { name: /^Links(?: \d+)?$/ }));
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Edit link' }));
  await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Link label' }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Link label' }), 'Updated brief');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save link' }));
  await waitFor(() =>
    expect(clients.updateLink).toHaveBeenCalledWith(record.id, 'link-1', 'Updated brief', 'https://example.com/brief'),
  );
  await userEvent.click(within(dialog).getByRole('button', { name: /^Files(?: \d+)?$/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add file' }));
  const file = new File(['%PDF-1.4'], 'brief.pdf', { type: 'application/pdf' });
  expect(within(dialog).getByRole('button', { name: 'Choose file' })).toBeEnabled();
  expect(within(dialog).getByText('No file selected')).toBeInTheDocument();
  await userEvent.upload(within(dialog).getByLabelText('Add a file'), file);
  expect(within(dialog).getByText('brief.pdf')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Upload file' }));
  await waitFor(() => expect(clients.addAttachment).toHaveBeenCalledWith(record.id, file));
});

it('opens the global create action with the saved theme', async () => {
  const theme = 'dark';
  localStorage.setItem('theme', theme);
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'New client' }));
  expect(document.documentElement).toHaveAttribute('data-theme', theme);
  expect(screen.getByRole('heading', { name: 'Clients', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'New client' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /View deals/ })).toBeEnabled();
});

it('shows a colleague’s newly created client after a fresh request and clears data across accounts', async () => {
  let currentUser = 'alice';
  const users = {
    alice: { id: 1, username: 'alice', email: '' },
    bob: { id: 2, username: 'bob', email: '' },
    outsider: { id: 3, username: 'outsider', email: '' },
  };
  const shared: Client[] = [];
  vi.spyOn(auth, 'me').mockResolvedValue({ user: users.alice });
  vi.spyOn(auth, 'logout').mockResolvedValue(undefined);
  vi.spyOn(auth, 'login').mockImplementation(async (username) => {
    currentUser = username;
    return users[username as keyof typeof users];
  });
  vi.mocked(clients.list).mockImplementation(async () => page(currentUser === 'outsider' ? [] : [...shared]));
  vi.mocked(clients.create).mockImplementation(async (data: ClientInput) => {
    const created = { ...record, ...data };
    shared.push(created);
    return created;
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'New client' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Company contact');
  await userEvent.click(screen.getByRole('button', { name: 'Save client' }));
  expect(await screen.findByRole('button', { name: 'Company contact' })).toBeInTheDocument();
  for (const username of ['bob', 'outsider']) {
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
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

it('refreshes note counts and overview after adding and deleting without closing details', async () => {
  vi.mocked(clients.list).mockResolvedValue(page([record]));
  const note = {
    id: 'note-new',
    client: record.id,
    deal: null,
    author: { id: 1, username: 'alex' },
    text: 'Updated requirements',
    created_at: '2026-11-18T12:00:00Z',
    can_delete: true,
  };
  let saved = false;
  vi.mocked(clients.notes).mockImplementation(async () => ({
    count: saved ? 1 : 0,
    results: saved ? [note] : [],
    next: null,
    previous: null,
  }));
  vi.spyOn(clients, 'addNote').mockImplementation(async () => {
    saved = true;
    return note;
  });
  vi.spyOn(clients, 'removeNote').mockImplementation(async () => {
    saved = false;
  });
  render(<ClientsPage />);
  await userEvent.click(await screen.findByRole('button', { name: record.name }));
  const dialog = screen.getByRole('dialog', { name: 'Client details' });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Notes 0' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
  await userEvent.type(within(dialog).getByLabelText('New note'), note.text);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
  expect(await within(dialog).findByRole('button', { name: 'Notes 1' })).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Overview' }));
  expect(within(dialog).getByRole('region', { name: 'notes preview' })).toHaveTextContent(note.text);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Notes 1' }));
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Delete note' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm deletion' }));
  expect(await within(dialog).findByRole('button', { name: 'Notes 0' })).toBeInTheDocument();
});
