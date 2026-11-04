export type User = { id: number; username: string; email: string; workspace?: { id: string; name: string } | null };
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
    if (response.status === 403 && payload?.error?.details?.detail === 'Authentication credentials were not provided.' && path !== '/auth/me') {
      window.dispatchEvent(new Event('session-expired'));
    }
    const messages: Record<number, string> = {
      400: 'Please check the submitted information.',
      403: 'Check your credentials or refresh the page and try again.',
      404: 'The requested record could not be found or is no longer available.',
      409: 'Related records prevent this action.',
      429: 'Too many attempts. Please wait before trying again.',
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
  async signup(username: string, email: string, password: string, password_confirm: string) {
    const session = await request<Session>('/auth/sign-up', { method: 'POST', body: JSON.stringify({ username, email, password, password_confirm }) });
    csrfToken = session.csrfToken ?? '';
    return session.user;
  },
  forgotPassword: (email: string) => request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  async resetPassword(data: { uid: string; token: string; password: string; password_confirm: string }) {
    const result = await request<{ message: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) });
    csrfToken = '';
    window.dispatchEvent(new Event('session-cleared'));
    return result;
  },
  providers: () => request<{ providers: Provider[] }>('/auth/providers'),
  methods: () => request<SignInMethods>('/auth/methods'),
  updateProfile: (username: string) => request<{ user: User }>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ username }) }),
  startProvider: (provider: string, process: 'login' | 'connect' = 'login') => request<{ url: string }>(`/auth/oauth/${provider}/start`, { method: 'POST', body: JSON.stringify({ process }) }),
  reauthenticate: (password: string) => request('/auth/reauthenticate', { method: 'POST', body: JSON.stringify({ password }) }),
  changePassword: (data: { current_password?: string; password: string; password_confirm: string }) => request('/auth/password', { method: 'POST', body: JSON.stringify(data) }),
  disconnect: (provider: string) => request(`/auth/providers/${provider}`, { method: 'DELETE' }),
  async logout() {
    const csrf = await request<{ csrfToken: string }>('/auth/csrf');
    csrfToken = csrf.csrfToken;
    await request<void>('/auth/logout', { method: 'POST' });
    csrfToken = '';
  },
};

export type Provider = { id: string; name: string; configured: boolean };
export type SignInMethods = { password: boolean; recent_auth: boolean; providers: string[] };
