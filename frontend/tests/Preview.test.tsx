import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

it('shows actions that belong to each preview page', async () => {
  await openPreview('dashboard');
  const actions = () => screen.getByRole('group', { name: 'Page actions' });
  expect(within(actions()).getByRole('button', { name: 'Explore deals' })).toBeInTheDocument();
  expect(within(actions()).getByRole('button', { name: 'New client' })).toBeInTheDocument();
  expect(screen.queryByText('10 clients · 21 deals · 12 invoices')).not.toBeInTheDocument();
  await userEvent.click(within(actions()).getByRole('button', { name: 'Explore deals' }));
  expect(within(actions()).getAllByRole('button').map(button => button.textContent)).toEqual(['View clients', 'New deal']);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Preview navigation' })).getByRole('button', { name: 'Clients10' }));
  expect(within(actions()).getAllByRole('button').map(button => button.textContent)).toEqual(['View deals', 'New client']);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Preview navigation' })).getByRole('button', { name: 'Invoices12' }));
  expect(within(actions()).getAllByRole('button').map(button => button.textContent)).toEqual(['View clients', 'Create invoice']);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Preview navigation' })).getByRole('button', { name: 'Settings' }));
  expect(within(actions()).queryAllByRole('button')).toHaveLength(0);
});

it('labels the invoice preview as unsaved and leaves export disabled', async () => {
  await openPreview('invoices');
  await userEvent.click(screen.getByRole('button', { name: 'Preview INV-1' }));
  const dialog = screen.getByRole('dialog', { name: 'Invoice preview' });
  expect(within(dialog).getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Print' })).toBeDisabled();
  expect(within(dialog).getByText(/not a saved or issued invoice/)).toBeInTheDocument();
});

it('keeps preview settings in place and updates the sidebar identity', async () => {
  await openPreview('settings');
  expect(screen.queryByRole('link', { name: /Open account settings/ })).not.toBeInTheDocument();
  await userEvent.clear(screen.getByRole('textbox', { name: 'Display name' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Display name' }), 'Taylor Reed');
  await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(within(screen.getByRole('button', { name: /Taylor Reed/ })).getByText('Taylor Reed')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Workspace$/ }));
  await userEvent.clear(screen.getByRole('textbox', { name: 'Workspace name' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'Field Studio');
  await userEvent.click(screen.getByRole('button', { name: 'Save workspace' }));
  expect(within(screen.getByRole('complementary')).getByText('Field Studio')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/preview');
  expect(window.location.hash).toBe('#/settings');
});

it('previews a selected avatar and rejects oversized files', async () => {
  await openPreview('settings');
  const input = screen.getByLabelText('Change photo');
  fireEvent.change(input, { target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getAllByLabelText('Preview User avatar')[0].querySelector('img')).toBeTruthy());
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })] } });
  expect(screen.getByRole('alert')).toHaveTextContent('under 2 MB');
});

it('keeps appearance changes inside the preview and applies the preferred deal currency', async () => {
  await openPreview('deals');
  expect(screen.queryByRole('group', { name: 'Preview theme' })).not.toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Preview navigation' })).getByRole('button', { name: 'Settings' }));
  const appTheme = document.documentElement.dataset.theme;
  await userEvent.click(screen.getByRole('button', { name: 'Appearance' }));
  await userEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
  expect(document.querySelector('.visual-workspace')).toHaveAttribute('data-preview-theme', 'dark');
  expect(document.documentElement.dataset.theme).toBe(appTheme);
  await userEvent.click(screen.getByRole('button', { name: 'Preferences' }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default deals currency' }), 'EUR');
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Preview navigation' })).getByRole('button', { name: 'Deals21' }));
  expect(screen.getByRole('combobox', { name: 'Deal currency' })).toHaveValue('EUR');
});

it('demonstrates password checks without submitting account credentials', async () => {
  await openPreview('settings');
  await userEvent.click(screen.getByRole('button', { name: 'Security' }));
  expect(screen.getByText(/Use made-up passwords only/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Current demo password'), 'old-demo-password');
  await userEvent.type(screen.getByLabelText('New demo password'), 'short');
  await userEvent.type(screen.getByLabelText('Confirm new demo password'), 'short');
  await userEvent.click(screen.getByRole('button', { name: 'Try password change' }));
  expect(screen.getByRole('alert')).toHaveTextContent('stronger demo password');
  await userEvent.clear(screen.getByLabelText('New demo password'));
  await userEvent.type(screen.getByLabelText('New demo password'), 'BetterDemoPassword123');
  await userEvent.clear(screen.getByLabelText('Confirm new demo password'));
  await userEvent.type(screen.getByLabelText('Confirm new demo password'), 'BetterDemoPassword123');
  await userEvent.click(screen.getByRole('button', { name: 'Try password change' }));
  expect(screen.getByRole('status')).toHaveTextContent('No account password was changed');
  expect(screen.getByLabelText('New demo password')).toHaveValue('');
  expect(workspace.preview).toHaveBeenCalledOnce();
});
