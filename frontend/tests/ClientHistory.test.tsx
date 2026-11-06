import { render, screen, within } from '@testing-library/react';
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
  expect(timestamp).toHaveTextContent(new Date(note.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }));
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

it.each([403, 404, 500])('renders history load errors independently and retries (%s)', async status => {
  vi.mocked(clients.notes).mockRejectedValueOnce(new ApiError(status, 'History unavailable.'));
  render(<ClientHistory clientId="client-1" />);
  const notes = within(screen.getByRole('region', { name: 'Notes' }));
  expect(await notes.findByRole('alert')).toHaveTextContent('History unavailable.');
  expect(screen.getByText('No links yet. Add a brief, design, or repository URL.')).toBeInTheDocument();
  await userEvent.click(notes.getByRole('button', { name: 'Retry notes' }));
  expect(await notes.findByText('No notes yet. Add the first update for your colleagues.')).toBeInTheDocument();
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
