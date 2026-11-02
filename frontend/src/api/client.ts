export type User = { id: number; username: string; email: string };
type Session = { user: User; csrfToken?: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let csrfToken = '';

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, response.status === 403
      ? 'Check your credentials or refresh the page and try again.'
      : 'The request failed. Please try again.');
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
