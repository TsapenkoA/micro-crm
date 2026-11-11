import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, auth, request } from '../src/api/client';

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

it('gets CSRF for writes after restoring a session and retains field validation errors', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { details: 'No session.' } }), { status: 403 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'restored' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { details: { email: ['Invalid email.'] } } }), { status: 400 }));
  vi.stubGlobal('fetch', fetch);
  await expect(auth.me()).rejects.toBeInstanceOf(ApiError);
  await expect(request('/clients', { method: 'POST', body: JSON.stringify({ name: 'Alex', email: 'invalid' }) }))
    .rejects.toMatchObject({ status: 400, details: { email: ['Invalid email.'] } });
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/auth/csrf');
  expect(fetch.mock.calls[2][1].headers['X-CSRFToken']).toBe('restored');
});

it('reports a missing record, server failure and lost network without exposing server internals', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('{}', { status: 404 }))
    .mockResolvedValueOnce(new Response('private traceback', { status: 500 }))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetch);
  await expect(request('/clients/missing')).rejects.toMatchObject({ status: 404, message: expect.stringContaining('could not be found') });
  await expect(request('/clients')).rejects.toMatchObject({ status: 500, message: expect.not.stringContaining('traceback') });
  await expect(request('/clients')).rejects.toThrow('Unable to reach the server.');
});

it('distinguishes expired sessions from CSRF denial and reports rate limits', async () => {
  const expired = vi.fn();
  window.addEventListener('session-expired', expired);
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { details: 'CSRF verification failed.' } }), { status: 403 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { details: { detail: 'Authentication credentials were not provided.' } } }), { status: 403 }))
    .mockResolvedValueOnce(new Response('{}', { status: 429 })));
  try {
    await expect(request('/clients')).rejects.toMatchObject({ status: 403 });
    expect(expired).not.toHaveBeenCalled();
    await expect(request('/clients')).rejects.toMatchObject({ status: 403 });
    expect(expired).toHaveBeenCalledOnce();
    await expect(request('/auth/providers')).rejects.toMatchObject({ status: 429, message: expect.stringContaining('Too many attempts') });
  } finally { window.removeEventListener('session-expired', expired); }
});

it('uploads an avatar as multipart data with session credentials', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ user: { id: 1, username: 'alex', email: '' }, csrfToken: 'upload' }))));
  vi.stubGlobal('fetch', fetch);
  await auth.uploadAvatar(new File(['photo'], 'avatar.png', { type: 'image/png' }));
  const options = fetch.mock.lastCall?.[1];
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.headers).not.toHaveProperty('Content-Type');
  expect(options.credentials).toBe('same-origin');
});
