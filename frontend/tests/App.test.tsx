import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { auth } from '../src/api/client';
import LoginForm from '../src/features/auth/LoginForm';

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
  await userEvent.type(screen.getByLabelText('Username'), 'alex');
  await userEvent.type(screen.getByLabelText('Password'), 'incorrect');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  expect(login).toHaveBeenCalledWith('alex', 'incorrect');
});
