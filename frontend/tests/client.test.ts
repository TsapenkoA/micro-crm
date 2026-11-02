import { afterEach, expect, it, vi } from 'vitest';
import { auth } from '../src/api/client';

afterEach(() => vi.unstubAllGlobals());

it('sends CSRF for login and refreshes it after session rotation', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'before' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 1, username: 'alex', email: '' }, csrfToken: 'after' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'fresh' })))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  await auth.login('alex', 'password');
  expect(fetch.mock.calls[1][1].headers['X-CSRFToken']).toBe('before');
  await auth.logout();
  expect(fetch.mock.calls[3][1].headers['X-CSRFToken']).toBe('fresh');
  expect(fetch.mock.calls[3][1].credentials).toBe('same-origin');
});
