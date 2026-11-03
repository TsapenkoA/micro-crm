import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import ClientHistory from '../src/features/clients/ClientHistory';
import { clients, type ClientLink, type ClientNote } from '../src/features/clients/api';

const note: ClientNote = { id: 'note-1', client: 'client-1', author: { id: 1, username: 'alice' }, text: 'Kickoff completed', created_at: '2026-01-01T12:00:00Z', can_delete: true };
const link: ClientLink = { id: 'link-1', client: 'client-1', label: 'Project brief', url: 'https://docs.google.com/document/d/example', created_at: '2026-01-01T12:00:00Z' };
const page = <T,>(results: T[] = []) => ({ count: results.length, results, next: null, previous: null });

beforeEach(() => {
  vi.spyOn(clients, 'notes').mockResolvedValue(page<ClientNote>());
  vi.spyOn(clients, 'links').mockResolvedValue(page<ClientLink>());
  vi.spyOn(clients, 'addNote').mockResolvedValue(note);
  vi.spyOn(clients, 'addLink').mockResolvedValue(link);
  vi.spyOn(clients, 'removeNote').mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

it('shows empty history and validates required fields and safe URL schemes', async () => {
  render(<ClientHistory clientId="client-1" />);
  expect(await screen.findByText('No notes yet. Add the first update for your colleagues.')).toBeInTheDocument();
  expect(screen.getByText('No links yet. Add a brief, design, or repository URL.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect(screen.getByLabelText('New note')).toHaveAccessibleDescription('Enter a note.');
  await userEvent.type(screen.getByLabelText('Link label'), 'Unsafe link');
  await userEvent.type(screen.getByLabelText('Link URL'), 'javascript:alert(1)');
  await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
  expect(screen.getByLabelText('Link URL')).toHaveAccessibleDescription('Enter a complete http:// or https:// URL.');
  expect(clients.addNote).not.toHaveBeenCalled();
  expect(clients.addLink).not.toHaveBeenCalled();
});

it('renders note text safely with a personal author and local timestamp', async () => {
  const text = '<img src=x onerror="alert(1)">\n<script>alert(2)</script>';
  vi.mocked(clients.notes).mockResolvedValue(page([{ ...note, text }]));
  const { container } = render(<ClientHistory clientId="client-1" />);
  const paragraph = await screen.findByText(value => value.includes('<img src=x'));
  expect(paragraph.textContent).toBe(text);
  expect(container.querySelector('script, img')).toBeNull();
  expect(screen.getByText('alice')).toBeInTheDocument();
  const timestamp = container.querySelector('time')!;
  expect(timestamp).toHaveAttribute('datetime', note.created_at);
  expect(timestamp).toHaveTextContent(new Date(note.created_at).toLocaleString());
});

it('opens validated external URLs safely and does not activate unsafe legacy URLs', async () => {
  vi.mocked(clients.links).mockResolvedValue(page([link, { ...link, id: 'legacy', label: '<script>Legacy</script>', url: 'javascript:alert(1)' }]));
  render(<ClientHistory clientId="client-1" />);
  const anchor = await screen.findByRole('link', { name: link.label });
  expect(anchor).toHaveAttribute('href', link.url);
  expect(anchor).toHaveAttribute('target', '_blank');
  expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('link', { name: '<script>Legacy</script>' })).not.toBeInTheDocument();
  expect(screen.getByText('<script>Legacy</script>')).toBeInTheDocument();
});

it('adds a note only after server confirmation and reloads it after remount', async () => {
  let resolve!: (value: ClientNote) => void;
  vi.mocked(clients.addNote).mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<ClientHistory clientId="client-1" />);
  await screen.findByText('No notes yet. Add the first update for your colleagues.');
  await userEvent.type(screen.getByLabelText('New note'), note.text);
  await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  expect(within(screen.getByRole('region', { name: 'Notes' })).queryByRole('list')).not.toBeInTheDocument();
  vi.mocked(clients.notes).mockResolvedValue(page([note]));
  resolve(note);
  expect(await screen.findByText(note.text)).toBeInTheDocument();
  expect(clients.addNote).toHaveBeenCalledWith('client-1', note.text);
  expect(screen.getByLabelText('New note')).toHaveValue('');
  view.unmount();
  render(<ClientHistory clientId="client-1" />);
  expect(await screen.findByText(note.text)).toBeInTheDocument();
});

it('preserves a rejected note draft and displays server field errors without a timeline entry', async () => {
  vi.mocked(clients.addNote).mockRejectedValue(new ApiError(400, 'Invalid note.', { text: ['A note is required.'] }));
  render(<ClientHistory clientId="client-1" />);
  await userEvent.type(screen.getByLabelText('New note'), 'Draft to keep');
  await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
  const notes = within(screen.getByRole('region', { name: 'Notes' }));
  expect(await notes.findByRole('alert')).toHaveTextContent('Please correct the highlighted fields.');
  expect(notes.getByLabelText('New note')).toHaveValue('Draft to keep');
  expect(notes.getByLabelText('New note')).toHaveAccessibleDescription('A note is required.');
  expect(notes.queryByRole('list')).not.toBeInTheDocument();
  expect(clients.notes).toHaveBeenCalledTimes(1);
});

it('adds a link in the current client and retains it after remount', async () => {
  const view = render(<ClientHistory clientId="client-1" />);
  await screen.findByText('No links yet. Add a brief, design, or repository URL.');
  await userEvent.type(screen.getByLabelText('Link label'), link.label);
  await userEvent.type(screen.getByLabelText('Link URL'), link.url);
  vi.mocked(clients.links).mockResolvedValue(page([link]));
  await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
  expect(await screen.findByRole('link', { name: link.label })).toBeInTheDocument();
  expect(clients.addLink).toHaveBeenCalledWith('client-1', link.label, link.url);
  expect(screen.getByLabelText('Link URL')).toHaveValue('');
  view.unmount();
  render(<ClientHistory clientId="client-1" />);
  expect(await screen.findByRole('link', { name: link.label })).toBeInTheDocument();
});

it('reports a server URL validation error under the link field', async () => {
  vi.mocked(clients.addLink).mockRejectedValue(new ApiError(400, 'Invalid URL.', { url: ['Enter a valid URL.'] }));
  render(<ClientHistory clientId="client-1" />);
  await userEvent.type(screen.getByLabelText('Link label'), link.label);
  await userEvent.type(screen.getByLabelText('Link URL'), link.url);
  await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please correct the highlighted fields.');
  expect(screen.getByLabelText('Link URL')).toHaveAccessibleDescription('Enter a valid URL.');
  expect(screen.getByLabelText('Link URL')).toHaveValue(link.url);
});

it.each([403, 404, 500])('renders history load errors independently and retries (%s)', async status => {
  vi.mocked(clients.notes).mockRejectedValueOnce(new ApiError(status, 'History unavailable.'));
  render(<ClientHistory clientId="client-1" />);
  const notes = within(screen.getByRole('region', { name: 'Notes' }));
  expect(await notes.findByRole('alert')).toHaveTextContent('History unavailable.');
  expect(screen.getByText('No links yet. Add a brief, design, or repository URL.')).toBeInTheDocument();
  await userEvent.click(notes.getByRole('button', { name: 'Retry notes' }));
  expect(await notes.findByText('No notes yet. Add the first update for your colleagues.')).toBeInTheDocument();
});

it('loads the last chronological page after creation so the saved note is visible', async () => {
  let created = false;
  vi.mocked(clients.notes).mockImplementation(async (_id, pageNumber) => pageNumber === 2
    ? { ...page([note]), count: 21, previous: '/notes?page=1' }
    : { ...page([{ ...note, id: 'old', text: 'Earlier update' }]), count: created ? 21 : 20, next: created ? '/notes?page=2' : null });
  vi.mocked(clients.addNote).mockImplementation(async () => { created = true; return note; });
  render(<ClientHistory clientId="client-1" />);
  await screen.findByText('Earlier update');
  await userEvent.type(screen.getByLabelText('New note'), note.text);
  await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect(await screen.findByText(note.text)).toBeInTheDocument();
  expect(screen.getByText('21 notes · Page 2')).toBeInTheDocument();
  expect(clients.notes).toHaveBeenLastCalledWith('client-1', 2, expect.any(AbortSignal));
});

it('shares a personal-author timeline between colleagues and hides it after a foreign client error', async () => {
  let account = 'alice';
  const history: ClientNote[] = [];
  vi.mocked(clients.notes).mockImplementation(async () => {
    if (account === 'outsider') throw new ApiError(404, 'Client not found.');
    return page(history.map(item => ({ ...item, can_delete: item.author.username === account })));
  });
  vi.mocked(clients.addNote).mockImplementation(async (_id, text) => {
    const saved = { ...note, id: account, text, author: { id: account === 'alice' ? 1 : 2, username: account } };
    history.push(saved);
    return saved;
  });
  let view = render(<ClientHistory clientId="client-1" />);
  await userEvent.type(screen.getByLabelText('New note'), 'Alice update');
  await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect(await screen.findByText('Alice update')).toBeInTheDocument();
  view.unmount();
  account = 'bob';
  view = render(<ClientHistory clientId="client-1" />);
  expect(await screen.findByText('Alice update')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('New note'), 'Bob update');
  await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect(await screen.findByText('Bob update')).toBeInTheDocument();
  expect(screen.getByText('alice')).toBeInTheDocument();
  expect(screen.getByText('bob')).toBeInTheDocument();
  view.unmount();
  account = 'outsider';
  render(<ClientHistory clientId="client-1" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Client not found.');
  expect(screen.queryByText('Alice update')).not.toBeInTheDocument();
  expect(screen.queryByText('Bob update')).not.toBeInTheDocument();
});

it('offers deletion only for notes the server identifies as belonging to the current author', async () => {
  vi.mocked(clients.notes).mockResolvedValue(page([note, { ...note, id: 'colleague', author: { id: 2, username: 'bob' }, text: 'Colleague note', can_delete: false }]));
  render(<ClientHistory clientId="client-1" />);
  const own = (await screen.findByText(note.text)).closest('li')!;
  const colleague = screen.getByText('Colleague note').closest('li')!;
  expect(within(own).getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
  expect(within(colleague).queryByRole('button', { name: 'Delete note' })).not.toBeInTheDocument();
});

it('confirms note deletion, disables duplicate requests and refetches persisted history', async () => {
  vi.mocked(clients.notes).mockResolvedValue(page([note]));
  let resolve!: () => void;
  vi.mocked(clients.removeNote).mockReturnValue(new Promise<void>(done => { resolve = done; }));
  const view = render(<ClientHistory clientId="client-1" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Delete note' }));
  expect(clients.removeNote).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(clients.removeNote).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Delete note' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  expect(screen.getByText(note.text)).toBeInTheDocument();
  vi.mocked(clients.notes).mockResolvedValue(page<ClientNote>());
  resolve();
  expect(await screen.findByText('Note deleted.')).toBeInTheDocument();
  expect(await screen.findByText('No notes yet. Add the first update for your colleagues.')).toBeInTheDocument();
  expect(clients.removeNote).toHaveBeenCalledWith('client-1', note.id);
  view.unmount();
  render(<ClientHistory clientId="client-1" />);
  expect(await screen.findByText('No notes yet. Add the first update for your colleagues.')).toBeInTheDocument();
});

it('keeps the note and confirmation visible after a rejected deletion', async () => {
  vi.mocked(clients.notes).mockResolvedValue(page([note]));
  vi.mocked(clients.removeNote).mockRejectedValue(new ApiError(403, 'Forbidden.'));
  render(<ClientHistory clientId="client-1" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Delete note' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Only the author can delete this note.');
  expect(screen.getByText(note.text)).toBeInTheDocument();
  expect(clients.notes).toHaveBeenCalledTimes(1);
});

it('returns to an available page after deleting the only note on the last page', async () => {
  let removed = false;
  const earlier = Array.from({ length: 20 }, (_, index) => ({ ...note, id: `old-${index}`, text: `Earlier ${index}`, can_delete: false }));
  vi.mocked(clients.notes).mockImplementation(async (_id, number) => number === 2
    ? { ...page([note]), count: 21, previous: '/notes?page=1' }
    : { ...page(earlier), count: removed ? 20 : 21, next: removed ? null : '/notes?page=2' });
  vi.mocked(clients.removeNote).mockImplementation(async () => { removed = true; });
  render(<ClientHistory clientId="client-1" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Next notes' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Delete note' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(await screen.findByText('20 notes · Page 1')).toBeInTheDocument();
  expect(screen.queryByText(note.text)).not.toBeInTheDocument();
});
