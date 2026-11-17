import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import ActivityPage from '../src/features/activity/ActivityPage';
import { activity, type ActivityEvent } from '../src/features/activity/api';

afterEach(() => vi.restoreAllMocks());

it('shows an empty history and filters workspace events', async () => {
  const list = vi.spyOn(activity, 'list').mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  render(<ActivityPage />);
  expect(await screen.findByText('No activity recorded yet. New changes will appear here.')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Activity type'), 'invoice');
  expect(list).toHaveBeenCalledWith(1, 'invoice', expect.any(AbortSignal), '', '', '');
});

it('renders changes as text and links to the record', async () => {
  const event: ActivityEvent = { id: 'event', actor_name: 'Sam', entity_type: 'deal', entity_id: 'deal-1', entity_label: '<script>Project</script>', action: 'updated', changes: { status: { from: 'new_lead', to: 'in_progress' } }, created_at: '2026-11-12T12:00:00Z' };
  vi.spyOn(activity, 'list').mockResolvedValue({ count: 1, next: null, previous: null, results: [event] });
  const { container } = render(<ActivityPage />);
  expect(await screen.findByText('<script>Project</script>')).toBeInTheDocument();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByRole('link', { name: '<script>Project</script>' })).toHaveAttribute('href', '#/deals?deal=deal-1');
  expect(screen.getByText('new lead → in progress')).toBeInTheDocument();
});

it('shows file names and bank-update actions without private values', async () => {
  const events: ActivityEvent[] = [
    { id: 'file', actor_name: 'Maya', entity_type: 'client', entity_id: 'client-1', entity_label: 'Aurora Studio', action: 'attachment_added', changes: { file: 'project-brief.pdf' }, created_at: '2026-11-12T12:00:00Z' },
    { id: 'bank', actor_name: 'Admin', entity_type: 'client', entity_id: 'client-1', entity_label: 'Aurora Studio', action: 'payer_bank_updated', changes: {}, created_at: '2026-11-12T11:00:00Z' },
  ];
  vi.spyOn(activity, 'list').mockResolvedValue({ count: 2, next: null, previous: null, results: events });
  render(<ActivityPage />);
  expect(await screen.findByText('project-brief.pdf')).toBeInTheDocument();
  expect(screen.getByText(/updated payer bank details for client/)).toBeInTheDocument();
  expect(screen.queryByText(/iban/i)).not.toBeInTheDocument();
});
