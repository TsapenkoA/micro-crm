import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { auth, workspace } from '../src/api/client';
import ThemeSelect from '../src/components/ThemeSelect';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('sidebar-collapsed');
});

it('opens each workspace section after restoring a session', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  render(<App />);
  await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
  const topNavigation = screen.getByRole('navigation', { name: 'Top navigation' });
  expect(within(topNavigation).getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
  expect(within(topNavigation).queryByRole('link', { name: 'Activity' })).not.toBeInTheDocument();
  const sideNavigation = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(sideNavigation).getByRole('button', { name: 'Activity' })).toBeInTheDocument();
  expect(within(sideNavigation).queryByRole('button', { name: 'Tasks' })).not.toBeInTheDocument();
  for (const page of ['Deals', 'Clients', 'Invoices', 'Settings']) {
    await userEvent.click(screen.getByRole('button', { name: new RegExp(page) }));
    expect(screen.getByRole('heading', { name: page, level: 1 })).toBeInTheDocument();
  }
  await userEvent.click(within(topNavigation).getByRole('link', { name: 'Clients' }));
  expect(screen.getByRole('heading', { name: 'Clients', level: 1 })).toBeInTheDocument();
}, 15000);

it('provides the shared create menu on Tasks and Operations', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  render(<App />);
  await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
  for (const navigateTo of [
    () => userEvent.click(screen.getByRole('link', { name: 'Tasks' })),
    () => userEvent.click(screen.getByRole('button', { name: 'Operations' })),
  ]) {
    await navigateTo();
    const page = await screen.findByRole('heading', { name: /Tasks|Operations/, level: 1 });
    const createButton = screen.getByRole('button', { name: 'Create' });
    await userEvent.click(createButton);
    const createMenu = screen.getByRole('group', { name: 'Create' });
    for (const entity of ['Client', 'Deal', 'Invoice'])
      expect(within(createMenu).getByRole('button', { name: entity })).toBeEnabled();
    await userEvent.keyboard('{Escape}');
    expect(createButton).toHaveAttribute('aria-expanded', 'false');
    expect(createButton).toHaveFocus();
    expect(page).toBeInTheDocument();
  }
});

it('shows live workspace counts in navigation', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({
    user: { id: 1, username: 'alex', email: '', workspace: { id: 'company-id', name: 'Example Studio' } },
  });
  vi.spyOn(workspace, 'counts').mockResolvedValue({ clients: 5, deals: 11, tasks: 8, invoices: 6 });
  render(<App />);
  const navigation = await screen.findByRole('navigation', { name: 'Main navigation' });
  expect(await within(navigation).findByText('11')).toBeInTheDocument();
  expect(within(navigation).getByText('5')).toBeInTheDocument();
  expect(within(navigation).getByText('6')).toBeInTheDocument();
  expect(within(navigation).getByRole('button', { name: 'Clients' })).toBeInTheDocument();
  const topNavigation = screen.getByRole('navigation', { name: 'Top navigation' });
  expect(within(topNavigation).getByText('11')).toBeInTheDocument();
  expect(within(topNavigation).getByText('8')).toBeInTheDocument();
});

it('collapses and restores the sidebar without losing navigation', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  render(<App />);
  await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
  await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
  expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
  expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  expect(await screen.findByRole('heading', { name: 'Activity', level: 1 })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
  expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
});

it('opens account actions from the avatar and closes the menu with Escape', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  const signOut = vi.spyOn(auth, 'logout').mockResolvedValue(undefined);
  render(<App />);
  const avatar = await screen.findByRole('button', { name: 'Account menu' });
  await userEvent.click(avatar);
  const menu = screen.getByRole('group', { name: 'Account menu' });
  expect(avatar).toHaveAttribute('aria-expanded', 'true');
  await userEvent.keyboard('{Escape}');
  expect(avatar).toHaveAttribute('aria-expanded', 'false');
  expect(avatar).toHaveFocus();
  await userEvent.click(avatar);
  await userEvent.click(
    within(screen.getByRole('group', { name: 'Account menu' })).getByRole('button', { name: 'Settings' }),
  );
  expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
  expect(avatar).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(avatar);
  await userEvent.click(
    within(screen.getByRole('group', { name: 'Account menu' })).getByRole('button', { name: 'Log out' }),
  );
  expect(signOut).toHaveBeenCalledOnce();
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  expect(menu).not.toBeInTheDocument();
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
  const media = {
    matches: true,
    addEventListener: vi.fn((_event, callback) => {
      changed = callback;
    }),
    removeEventListener: vi.fn(),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  const view = render(<ThemeSelect />);
  expect(screen.getByLabelText('Theme')).toHaveValue('system');
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  act(() => {
    media.matches = false;
    changed();
  });
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

it('resets page scroll on navigation and browser history changes', async () => {
  vi.spyOn(auth, 'me').mockResolvedValue({ user: { id: 1, username: 'alex', email: '' } });
  render(<App />);
  await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
  vi.mocked(window.scrollTo).mockClear();
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  vi.mocked(window.scrollTo).mockClear();
  await act(async () => {
    window.location.hash = '/clients';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
});
