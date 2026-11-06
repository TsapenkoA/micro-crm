import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { workspace } from '../src/api/client';
import type { PreviewData } from '../src/features/preview/data';

afterEach(() => vi.restoreAllMocks());

const preview: PreviewData = {
  clients: Array.from({ length: 10 }, (_, index) => ({ id: `client-${index}`, name: `Client ${index + 1}`, company: `Company ${index + 1}`, email: `client${index + 1}@example.test`, phone: '', initials: 'CL', color: 'blue' })),
  deals: Array.from({ length: 21 }, (_, index) => ({ id: `deal-${index}`, title: `Project ${index + 1}`, client: `client-${index % 10}`, amount: 0, currency: 'USD', status: 'new_lead', deadline: '2026-11-04', category: 'Project' })),
  invoices: Array.from({ length: 12 }, (_, index) => ({ id: `INV-${index + 1}`, client: `client-${index % 10}`, description: 'Service', amount: 0, status: 'draft', date: '2026-11-04' })),
  profile: { name: 'Preview User', username: 'preview.user', email: 'preview@example.test', avatar: '' },
  workspaceName: 'Preview Workspace',
  content: { dealNextStep: 'Next step', dealNote: 'Sample deal note', dealNoteTime: 'Today', clientNote: 'Sample client note', clientNoteTime: 'Today', linkLabel: 'Sample link', invoiceFromDescription: 'Sample services' },
};

async function openPreview(page = 'deals') {
  vi.spyOn(workspace, 'preview').mockResolvedValue(preview);
  window.history.replaceState(null, '', `/preview#/${page}`);
  render(<App />);
  await screen.findByRole('navigation', { name: 'Preview navigation' });
}

it('loads workspace preview through its dedicated API', async () => {
  await openPreview();
  expect(screen.getByRole('heading', { level: 1, name: 'Deals' })).toBeInTheDocument();
  expect(screen.queryByText('Design preview')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to application' })).toHaveAttribute('href', '/');
  expect(document.title).toBe('MicroFlow · Preview');
  expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', expect.stringContaining('data:image/svg+xml'));
  expect(workspace.preview).toHaveBeenCalledOnce();
});

it('labels the invoice preview as unsaved and leaves export disabled', async () => {
  await openPreview('invoices');
  await userEvent.click(screen.getByRole('button', { name: 'Preview INV-1' }));
  const dialog = screen.getByRole('dialog', { name: 'Invoice preview' });
  expect(within(dialog).getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Print' })).toBeDisabled();
  expect(within(dialog).getByText(/not a saved or issued invoice/)).toBeInTheDocument();
});
