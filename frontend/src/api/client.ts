export type User = { id: number; username: string; email: string };
type Session = { user: User; csrfToken?: string };

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

let csrfToken = '';

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !csrfToken) {
    const csrf = await request<{ csrfToken: string }>('/auth/csrf');
    csrfToken = csrf.csrfToken;
  }
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
        ...options.headers,
      },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause;
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    if (response.status === 403) csrfToken = '';
    const messages: Record<number, string> = {
      400: 'Please check the submitted information.',
      403: 'Check your credentials or refresh the page and try again.',
      404: 'The requested record could not be found or is no longer available.',
      409: 'Related records prevent this action.',
    };
    throw new ApiError(response.status, messages[response.status] ?? 'The server could not complete the request. Please try again.', payload?.error?.details);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const auth = {
  me: () => request<Session>('/auth/me'),
  async login(username: string, password: string) {
    const csrf = await request<{ csrfToken: string }>('/auth/csrf');
    csrfToken = csrf.csrfToken;
    const session = await request<Session>('/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    });
    csrfToken = session.csrfToken ?? '';
    return session.user;
  },
  async logout() {
    const csrf = await request<{ csrfToken: string }>('/auth/csrf');
    csrfToken = csrf.csrfToken;
    await request<void>('/auth/logout', { method: 'POST' });
    csrfToken = '';
  },
};
