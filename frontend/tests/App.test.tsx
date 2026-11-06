import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { auth, workspace } from '../src/api/client';
import LoginForm from '../src/features/auth/LoginForm';
import ThemeSelect from '../src/components/ThemeSelect';

afterEach(() => vi.restoreAllMocks());

it('opens each workspace section after restoring a session', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  render(<App />);
  await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
  for (const page of ['Deals', 'Clients', 'Invoices', 'Settings']) {
    await userEvent.click(screen.getByRole('button', { name: new RegExp(page) }));
    expect(screen.getByRole('heading', { name: page, level: 1 })).toBeInTheDocument();
  }
});

it('requires credentials and reports a failed login', async () => {
  const login = vi.spyOn(auth, 'login').mockRejectedValue(new Error('Invalid credentials'));
  render(<LoginForm onLogin={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(login).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Email or username'), 'alex');
  await userEvent.type(screen.getByLabelText('Password'), 'incorrect');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  expect(login).toHaveBeenCalledWith('alex', 'incorrect');
});

it('shows the active workspace in navigation and account settings', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '', workspace: { id: 'company-id', name: 'Example Studio' } } });
  render(<App />);
  expect(await screen.findByText('Example Studio')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }));
  expect(screen.getAllByText('Example Studio')).toHaveLength(2);
  await userEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
  expect(window.location.hash).toBe('#/settings');
  expect(screen.getByRole('main')).toHaveFocus();
});

it('shows live workspace counts in navigation', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '', workspace: { id: 'company-id', name: 'Example Studio' } } });
  vi.spyOn(workspace, 'counts').mockResolvedValue({ clients: 5, deals: 11, invoices: 6 });
  render(<App />);
  const navigation = await screen.findByRole('navigation', { name: 'Main navigation' });
  expect(await within(navigation).findByText('11')).toBeInTheDocument();
  expect(within(navigation).getByText('5')).toBeInTheDocument();
  expect(within(navigation).getByText('6')).toBeInTheDocument();
  expect(within(navigation).getByRole('button', { name: 'Clients' })).toBeInTheDocument();
});

it('shows page-specific actions and keeps appearance in account settings', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  render(<App />);
  await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
  expect(document.querySelector('.workspace-brand')).toHaveTextContent('MicroFlow');
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /View design preview/ })).not.toBeInTheDocument();
  expect(screen.queryByText('YOUR WORK, IN FOCUS')).not.toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Page actions' })).getByRole('button', { name: '+ New client' })).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: 'Deals' }));
  expect(within(screen.getByRole('group', { name: 'Page actions' })).getAllByRole('button').map(button => button.textContent)).toEqual(['View clients →', '+ Create invoice', '+ New deal']);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: 'Settings' }));
  expect(within(screen.getByRole('group', { name: 'Page actions' })).getByRole('button', { name: '+ Create invoice' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Account settings sections' })).getByRole('button', { name: 'Appearance' }));
  expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
});

it('opens and closes navigation with Escape and restores focus', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  render(<App />);
  const trigger = await screen.findByRole('button', { name: 'Open menu' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await userEvent.keyboard('{Escape}');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveFocus();
});

it('follows system theme changes and preserves an explicit preference', async () => {
  let changed!: () => void;
  const media = { matches: true, addEventListener: vi.fn((_event, callback) => { changed = callback; }), removeEventListener: vi.fn() };
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  const view = render(<ThemeSelect />);
  expect(screen.getByLabelText('Theme')).toHaveValue('system');
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  act(() => { media.matches = false; changed(); });
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  await userEvent.selectOptions(screen.getByLabelText('Theme'), 'dark');
  expect(localStorage.getItem('theme')).toBe('dark');
  act(() => changed());
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  view.unmount();
  render(<ThemeSelect />);
  expect(screen.getByLabelText('Theme')).toHaveValue('dark');
  expect(media.removeEventListener).toHaveBeenCalled();
});
