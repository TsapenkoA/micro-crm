import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, auth } from '../src/api/client';
import App from '../src/app/App';
import AuthScreen from '../src/features/auth/AuthScreen';
import AccountSettings from '../src/features/auth/AccountSettings';

const user = { id: 1, username: 'alex', email: 'alex@example.com', workspace: { id: 'workspace', name: 'Example Studio' } };
const providers = [{ id: 'google', name: 'Google', configured: false }, { id: 'github', name: 'GitHub', configured: false }, { id: 'microsoft', name: 'Microsoft', configured: false }];

beforeEach(() => {
  vi.spyOn(auth, 'providers').mockResolvedValue({ providers });
  vi.spyOn(auth, 'methods').mockResolvedValue({ password: true, recent_auth: true, providers: [] });
});
afterEach(() => vi.restoreAllMocks());

it('supports password visibility and keyboard email login', async () => {
  const login = vi.spyOn(auth, 'login').mockResolvedValue(user);
  const onLogin = vi.fn();
  render(<AuthScreen path="/login" onLogin={onLogin} />);
  await userEvent.type(screen.getByLabelText('Email or username'), user.email);
  const password = screen.getByLabelText('Password');
  await userEvent.type(password, 'test-password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password).toHaveAttribute('type', 'text');
  await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password).toHaveAttribute('type', 'password');
  password.focus();
  await userEvent.keyboard('{Enter}');
  expect(login).toHaveBeenCalledWith(user.email, 'test-password-123');
  expect(onLogin).toHaveBeenCalledWith(user);
});

it('disables unconfigured providers instead of simulating sign-in', async () => {
  const start = vi.spyOn(auth, 'startProvider');
  render(<AuthScreen path="/login" onLogin={vi.fn()} />);
  for (const provider of providers) {
    const button = await screen.findByRole('button', { name: `${provider.name} · Not configured` });
    expect(button).toBeDisabled();
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  }
  expect(start).not.toHaveBeenCalled();
});

it('switches auth appearance with accessible sun, moon and system controls', async () => {
  render(<AuthScreen path="/login" onLogin={vi.fn()} />);
  expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'System theme' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  expect(screen.getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Light theme' }));
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  expect(localStorage.getItem('theme')).toBe('light');
});

it('reports a configured provider failure and permits a retry', async () => {
  vi.mocked(auth.providers).mockResolvedValue({ providers: [{ ...providers[0], configured: true }] });
  const start = vi.spyOn(auth, 'startProvider').mockRejectedValue(new Error('Provider unavailable.'));
  render(<AuthScreen path="/login" onLogin={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Google' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Provider unavailable.');
  expect(start).toHaveBeenCalledWith('google');
  expect(screen.getByRole('button', { name: 'Google' })).toBeEnabled();
});

it('prevents duplicate signup while saving', async () => {
  let complete!: (value: typeof user) => void;
  const signup = vi.spyOn(auth, 'signup').mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const onLogin = vi.fn();
  render(<AuthScreen path="/sign-up" onLogin={onLogin} />);
  await userEvent.type(screen.getByLabelText('Username'), 'alex');
  await userEvent.type(screen.getByLabelText('Email'), user.email);
  await userEvent.type(screen.getByLabelText('Password'), 'test-password-123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'test-password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByLabelText('Email')).toBeDisabled();
  expect(signup).toHaveBeenCalledOnce();
  await act(async () => complete(user));
  expect(onLogin).toHaveBeenCalledWith(user);
});

it('restores account settings after a successful OAuth connection', async () => {
  window.history.replaceState(null, '', '/oauth-result?status=connected');
  vi.spyOn(auth, 'me').mockResolvedValue({ user });
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
  expect(window.location.hash).toBe('#/settings');
  expect(screen.queryByText('Provider sign-in could not be completed. Please try again.')).not.toBeInTheDocument();
});

it('opens Dashboard after a successful OAuth signup or sign-in', async () => {
  window.history.replaceState(null, '', '/oauth-result?status=success');
  vi.spyOn(auth, 'me').mockResolvedValue({ user });
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
  expect(window.location.hash).toBe('#/dashboard');
  expect(screen.queryByText('Accounts are not merged by email.')).not.toBeInTheDocument();
});

it('validates signup, preserves server field errors and completes a real submission', async () => {
  const signup = vi.spyOn(auth, 'signup').mockRejectedValueOnce(new ApiError(400, 'Check the form.', { email: ['Unable to create account.'] })).mockResolvedValue(user);
  const onLogin = vi.fn();
  render(<AuthScreen path="/sign-up" onLogin={onLogin} />);
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  expect(signup).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Username'), 'alex');
  await userEvent.type(screen.getByLabelText('Email'), user.email);
  await userEvent.type(screen.getByLabelText('Password'), 'test-password-123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'mismatch');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Confirm password'));
  await userEvent.type(screen.getByLabelText('Confirm password'), 'test-password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('Unable to create account.')).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toHaveValue(user.email);
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(onLogin).toHaveBeenCalledWith(user);
  expect(signup).toHaveBeenLastCalledWith('alex', user.email, 'test-password-123', 'test-password-123');
});

it('keeps password reset requests neutral and reports network errors', async () => {
  vi.spyOn(auth, 'forgotPassword').mockRejectedValueOnce(new Error('Network unavailable.')).mockResolvedValue({ message: 'If an eligible account exists, password reset instructions will be sent.' });
  render(<AuthScreen path="/forgot-password" onLogin={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Email'), user.email);
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable.');
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByRole('status')).toHaveTextContent('If an eligible account exists');
});

it('shows username validation errors on signup without losing the entered name', async () => {
  vi.spyOn(auth, 'signup').mockRejectedValue(new ApiError(400, 'Please check the form.', { username: ['This username is already taken.'] }));
  render(<AuthScreen path="/sign-up" onLogin={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Username'), 'ChosenName');
  await userEvent.type(screen.getByLabelText('Email'), user.email);
  await userEvent.type(screen.getByLabelText('Password'), 'test-password-123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'test-password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('This username is already taken.')).toBeInTheDocument();
  expect(screen.getByLabelText('Username')).toHaveValue('ChosenName');
  expect(screen.getByLabelText('Username')).toHaveAccessibleDescription('This username is already taken.');
});

it('updates an existing technical username from Settings and returns the refreshed account', async () => {
  const updated = { ...user, username: 'ChosenName', workspace: { ...user.workspace, name: "ChosenName's workspace" } };
  const update = vi.spyOn(auth, 'updateProfile').mockResolvedValue({ user: updated });
  const onUserUpdated = vi.fn();
  render(<AccountSettings user={user} onUserUpdated={onUserUpdated} />);
  const field = screen.getByLabelText('Username');
  await userEvent.clear(field);
  await userEvent.type(field, 'ChosenName');
  await userEvent.click(screen.getByRole('button', { name: 'Save username' }));
  await waitFor(() => expect(onUserUpdated).toHaveBeenCalledWith(updated));
  expect(update).toHaveBeenCalledWith('ChosenName');
  expect(await screen.findByText('Username updated.')).toBeInTheDocument();
});

it('submits a reset token and removes it from the URL after success', async () => {
  window.history.replaceState(null, '', '/reset-password?uid=MQ&token=reset-token');
  const reset = vi.spyOn(auth, 'resetPassword').mockResolvedValue({ message: 'Password updated. Sign in with your new password.' });
  render(<AuthScreen path="/reset-password" onLogin={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Password'), 'new-password-123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'new-password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(reset).toHaveBeenCalledWith({ uid: 'MQ', token: 'reset-token', password: 'new-password-123', password_confirm: 'new-password-123' });
  expect(await screen.findByRole('status')).toHaveTextContent('Password updated.');
  expect(window.location.search).toBe('');
});

it('explains invalid reset links and safe OAuth collision results', async () => {
  const view = render(<AuthScreen path="/reset-password" onLogin={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('This reset link is invalid');
  view.unmount();
  window.history.replaceState(null, '', '/oauth-result?status=account');
  render(<AuthScreen path="/oauth-result" onLogin={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Accounts are not merged by email');
});

it('protects routes, restores the selected section after login and clears an expired session', async () => {
  window.history.replaceState(null, '', '/#/settings');
  vi.spyOn(auth, 'me').mockRejectedValue(new ApiError(403, 'No session.'));
  vi.spyOn(auth, 'login').mockResolvedValue(user);
  render(<App />);
  await screen.findByRole('heading', { name: 'Welcome back' });
  expect(window.location.pathname).toBe('/login');
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Email or username'), user.email);
  await userEvent.type(screen.getByLabelText('Password'), 'test-password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
  expect(window.location.hash).toBe('#/settings');
  act(() => window.dispatchEvent(new Event('session-expired')));
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(screen.getByText('Your session has expired. Please sign in again.')).toBeInTheDocument();
});

it('does not allow the UI to disconnect a social-only accounts final method', async () => {
  vi.mocked(auth.methods).mockResolvedValue({ password: false, recent_auth: true, providers: ['google'] });
  render(<AccountSettings user={user} />);
  expect(await screen.findByRole('button', { name: 'Disconnect Google' })).toBeDisabled();
  expect(screen.getByRole('heading', { name: 'Set a password' })).toBeInTheDocument();
});

it('requires confirmation before disconnecting and refreshes methods after saving a password', async () => {
  vi.mocked(auth.methods).mockResolvedValue({ password: true, recent_auth: true, providers: ['google'] });
  const disconnect = vi.spyOn(auth, 'disconnect').mockResolvedValue(undefined);
  const change = vi.spyOn(auth, 'changePassword').mockResolvedValue(undefined);
  render(<AccountSettings user={user} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Disconnect Google' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(disconnect).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Disconnect Google' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
  await waitFor(() => expect(disconnect).toHaveBeenCalledWith('google'));
  await userEvent.type(screen.getByLabelText('Current password'), 'old-password-123');
  await userEvent.type(screen.getByLabelText('New password'), 'new-password-123');
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'new-password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(change).toHaveBeenCalledWith({ current_password: 'old-password-123', password: 'new-password-123', password_confirm: 'new-password-123' });
  expect(auth.methods).toHaveBeenCalledTimes(3);
});
