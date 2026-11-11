import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, auth, workspace } from '../src/api/client';
import App from '../src/app/App';
import AuthScreen from '../src/features/auth/AuthScreen';
import AccountSettings from '../src/features/auth/AccountSettings';

const user = { id: 1, username: 'alex', email: 'alex@example.com', workspace: { id: 'workspace', name: 'Example Studio' } };
const providers = [{ id: 'google', name: 'Google', configured: false }, { id: 'github', name: 'GitHub', configured: false }, { id: 'microsoft', name: 'Microsoft', configured: false }];

beforeEach(() => {
  vi.spyOn(auth, 'providers').mockResolvedValue({ providers });
  vi.spyOn(auth, 'methods').mockResolvedValue({ password: true, recent_auth: true, providers: [] });
  vi.spyOn(workspace, 'settings').mockResolvedValue({ id: 'workspace', name: 'Example Studio', can_manage_members: true, members: [{ id: 1, username: 'alex', name: '', email: user.email }] });
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

it('reports a configured provider failure and permits a retry', async () => {
  vi.mocked(auth.providers).mockResolvedValue({ providers: [{ ...providers[0], configured: true }] });
  const start = vi.spyOn(auth, 'startProvider').mockRejectedValue(new Error('Provider unavailable.'));
  render(<AuthScreen path="/login" onLogin={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Google' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Provider unavailable.');
  expect(start).toHaveBeenCalledWith('google');
  expect(screen.getByRole('button', { name: 'Google' })).toBeEnabled();
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

it('validates signup, preserves server field errors and requests verification', async () => {
  const signup = vi.spyOn(auth, 'signup').mockRejectedValueOnce(new ApiError(400, 'Check the form.', { email: ['Unable to create account.'] })).mockResolvedValue({ message: 'Check your email for a verification link.' });
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
  expect(await screen.findByText('Check your email for a verification link.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Resend verification email' })).toBeInTheDocument();
  expect(onLogin).not.toHaveBeenCalled();
  expect(signup).toHaveBeenLastCalledWith('alex', user.email, 'test-password-123', 'test-password-123');
});

it('verifies a signup link before opening the workspace', async () => {
  window.history.replaceState(null, '', '/verify-email?token=one-time-token');
  const verify = vi.spyOn(auth, 'verifyEmail').mockResolvedValue(user);
  const onLogin = vi.fn();
  render(<AuthScreen path="/verify-email" onLogin={onLogin} />);
  await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));
  expect(verify).toHaveBeenCalledWith('one-time-token');
  expect(onLogin).toHaveBeenCalledWith(user);
});

it('resends a verification link without exposing account existence', async () => {
  const resend = vi.spyOn(auth, 'resendVerification').mockResolvedValue({ message: 'Check your email for a verification link.' });
  render(<AuthScreen path="/resend-verification" onLogin={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Email'), user.email);
  await userEvent.click(screen.getByRole('button', { name: 'Resend email' }));
  expect(resend).toHaveBeenCalledWith(user.email);
  expect(await screen.findByText('Check your email for a verification link.')).toBeInTheDocument();
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

it('saves workspace payment details for new invoices', async () => {
  const load = vi.spyOn(workspace, 'bankDetails').mockResolvedValue({ bank_name: 'Example Bank' });
  const save = vi.spyOn(workspace, 'saveBankDetails').mockImplementation(async value => value);
  render(<AccountSettings user={user} />);
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }));
  expect(await screen.findByRole('button', { name: 'Reveal payment details' })).toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Reveal payment details' }));
  expect(await screen.findByDisplayValue('Example Bank')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('IBAN'), 'DE89370400440532013000');
  await userEvent.click(screen.getByRole('button', { name: 'Save payment details' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ bank_name: 'Example Bank', iban: 'DE89370400440532013000' })));
  expect(load).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Hide details' }));
  expect(screen.queryByDisplayValue('Example Bank')).not.toBeInTheDocument();
});

it('asks the owner to confirm identity before revealing payment details', async () => {
  const load = vi.spyOn(workspace, 'bankDetails').mockRejectedValue(new ApiError(403, 'Forbidden'));
  render(<AccountSettings user={user} />);
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Reveal payment details' }));
  expect(await screen.findByText('Confirm your identity in Security, then return to reveal payment details.')).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('IBAN')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm identity in Security' }));
  expect(screen.getByRole('heading', { name: 'Password & security' })).toBeInTheDocument();
});

it('does not request or show bank details to a workspace member', async () => {
  vi.mocked(workspace.settings).mockResolvedValue({ id: 'workspace', name: 'Example Studio', can_manage_members: false, members: [{ id: 1, username: 'alex', name: '', email: user.email }] });
  const load = vi.spyOn(workspace, 'bankDetails');
  render(<AccountSettings user={user} />);
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }));
  expect(await screen.findByText('Payment details are available to the workspace owner.')).toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Save payment details' })).not.toBeInTheDocument();
});

it('renames the shared workspace and shows its members', async () => {
  const rename = vi.spyOn(workspace, 'rename').mockResolvedValue({ id: 'workspace', name: 'Northstar Studio' });
  const onUserUpdated = vi.fn();
  render(<AccountSettings user={user} onUserUpdated={onUserUpdated} />);
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }));
  expect(await screen.findByText('alex (you)')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Name'));
  await userEvent.type(screen.getByLabelText('Name'), 'Northstar Studio');
  await userEvent.click(screen.getByRole('button', { name: 'Save workspace name' }));
  await waitFor(() => expect(rename).toHaveBeenCalledWith('Northstar Studio'));
  expect(onUserUpdated).toHaveBeenCalledWith(expect.objectContaining({ workspace: { id: 'workspace', name: 'Northstar Studio' } }));
});

it('keeps platform checks out of account settings', async () => {
  render(<AccountSettings user={{ ...user, is_workspace_owner: true }} />);
  expect(screen.queryByRole('button', { name: 'Operations' })).not.toBeInTheDocument();
  for (const section of ['Profile', 'Appearance', 'Workspace', 'Security']) {
    await userEvent.click(screen.getByRole('button', { name: section }));
    expect(screen.getByRole('button', { name: section })).toHaveAttribute('aria-current', 'page');
  }
});

it('lets the workspace owner add an existing account', async () => {
  const add = vi.spyOn(workspace, 'addMember').mockResolvedValue({ member: { id: 2, username: 'colleague', name: 'Sam Parker', email: 'sam@example.test' } });
  render(<AccountSettings user={user} />);
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }));
  await userEvent.type(await screen.findByLabelText('Username'), 'colleague');
  await userEvent.click(screen.getByRole('button', { name: 'Add member' }));
  await waitFor(() => expect(add).toHaveBeenCalledWith('colleague'));
  expect(await screen.findByText('Sam Parker')).toBeInTheDocument();
});

it('uploads and removes the profile photo through the account API', async () => {
  const withPhoto = { ...user, avatar_url: '/api/v1/auth/avatar?v=1' };
  const upload = vi.spyOn(auth, 'uploadAvatar').mockResolvedValue({ user: withPhoto });
  const remove = vi.spyOn(auth, 'removeAvatar').mockResolvedValue({ user: { ...user, avatar_url: null } });
  const onUserUpdated = vi.fn();
  const { rerender } = render(<AccountSettings user={user} onUserUpdated={onUserUpdated} />);
  const file = new File(['image bytes'], 'photo.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText('Photo'), file);
  await userEvent.click(screen.getByRole('button', { name: 'Save photo' }));
  await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
  expect(onUserUpdated).toHaveBeenCalledWith(withPhoto);
  rerender(<AccountSettings user={withPhoto} onUserUpdated={onUserUpdated} />);
  await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
  await waitFor(() => expect(remove).toHaveBeenCalled());
  expect(onUserUpdated).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: null }));
});

it('saves a non-USD reporting currency in Settings', async () => {
  const update = vi.spyOn(auth, 'updateReportingCurrency').mockResolvedValue({ reporting_currency: 'JPY' });
  const onUserUpdated = vi.fn();
  render(<AccountSettings user={{ ...user, reporting_currency: 'USD' }} onUserUpdated={onUserUpdated} />);
  await userEvent.click(screen.getByRole('button', { name: 'Appearance' }));
  await userEvent.selectOptions(screen.getByLabelText('Reporting currency'), 'JPY');
  await waitFor(() => expect(update).toHaveBeenCalledWith('JPY'));
  expect(onUserUpdated).toHaveBeenCalledWith(expect.objectContaining({ reporting_currency: 'JPY' }));
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
  await userEvent.click(screen.getByRole('button', { name: 'Security' }));
  expect(await screen.findByRole('button', { name: 'Disconnect Google' })).toBeDisabled();
  expect(screen.getByRole('heading', { name: 'Set a password' })).toBeInTheDocument();
});

it('requires confirmation before disconnecting and refreshes methods after saving a password', async () => {
  vi.mocked(auth.methods).mockResolvedValue({ password: true, recent_auth: true, providers: ['google'] });
  const disconnect = vi.spyOn(auth, 'disconnect').mockResolvedValue(undefined);
  const change = vi.spyOn(auth, 'changePassword').mockResolvedValue(undefined);
  render(<AccountSettings user={user} />);
  await userEvent.click(screen.getByRole('button', { name: 'Security' }));
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
