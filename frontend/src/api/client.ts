import type { PreviewData } from '../features/preview/data';

export const reportingCurrencies = ['USD', 'EUR', 'GBP', 'PLN', 'AUD', 'CAD', 'CHF', 'JPY'] as const;
export type ReportingCurrency = typeof reportingCurrencies[number];
export type User = { id: number; username: string; email: string; avatar_url?: string | null; reporting_currency?: ReportingCurrency; workspace?: { id: string; name: string } | null; is_workspace_owner?: boolean };
export type WorkspaceCounts = { clients: number; deals: number; tasks: number; invoices: number };
export type WorkspaceSettings = { id: string; name: string; can_manage_members: boolean; join_requests?: { id: string; workspace_name: string; expires_at: string }[]; members: { id: number; username: string; name: string; email: string }[] };
export type BankDetails = { account_holder?: string; bank_name?: string; iban?: string; bic?: string; account_number?: string; routing_number?: string; payment_instructions?: string };
export type SellerDetails = { name: string; email: string; phone?: string; address?: string; tax_id?: string };
type Session = { user: User; csrfToken?: string };

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown, public reason?: string) { super(message); }
}

function serverMessage(details: unknown): string | undefined {
  if (typeof details === 'string') return details;
  if (!details || typeof details !== 'object') return undefined;
  const values = Array.isArray(details) ? details : Object.values(details);
  const messages = values.map(serverMessage).filter((value): value is string => !!value);
  return messages.length ? messages.slice(0, 5).join(' ').slice(0, 1000) : undefined;
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
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
    if (response.status === 403 && (payload?.error?.reason === 'not_authenticated' || payload?.error?.details?.detail === 'Authentication credentials were not provided.') && path !== '/auth/me') {
      window.dispatchEvent(new Event('session-expired'));
    }
    const messages: Record<number, string> = {
      400: 'Please check the submitted information.',
      403: 'Check your credentials or refresh the page and try again.',
      404: 'The requested record could not be found or is no longer available.',
      409: 'Related records prevent this action.',
      429: 'Too many attempts. Please wait before trying again.',
    };
    const details = payload?.error?.details;
    const message = response.status < 500 || response.status === 503 ? serverMessage(details) : undefined;
    throw new ApiError(response.status, message || messages[response.status] || 'The server could not complete the request. Please try again.', details, payload?.error?.reason);
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
  signup: (username: string, email: string, password: string, password_confirm: string) =>
    request<{ message: string }>('/auth/sign-up', { method: 'POST', body: JSON.stringify({ username, email, password, password_confirm }) }),
  resendVerification: (email: string) => request<{ message: string }>('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),
  async verifyEmail(token: string, password: string) {
    const session = await request<Session>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token, password }) });
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
  requestEmailChange: (email: string) => request<{ message: string }>('/auth/email-change', { method: 'POST', body: JSON.stringify({ email }) }),
  confirmEmailChange: (token: string) => request<{ user: User }>('/auth/email-change/confirm', { method: 'POST', body: JSON.stringify({ token }) }),
  uploadAvatar: (file: File) => {
    const form = new FormData(); form.append('avatar', file);
    return request<{ user: User }>('/auth/avatar', { method: 'POST', body: form });
  },
  removeAvatar: () => request<{ user: User }>('/auth/avatar', { method: 'DELETE' }),
  updateReportingCurrency: (reporting_currency: ReportingCurrency) => request<{ reporting_currency: ReportingCurrency }>('/auth/reporting-currency', { method: 'PATCH', body: JSON.stringify({ reporting_currency }) }),
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

export const workspace = {
  counts: (signal?: AbortSignal) => request<WorkspaceCounts>('/workspace/counts', { signal }),
  settings: () => request<WorkspaceSettings>('/workspace/settings'),
  rename: (name: string) => request<Pick<WorkspaceSettings, 'id' | 'name'>>('/workspace/settings', { method: 'PATCH', body: JSON.stringify({ name }) }),
  addMember: (username: string) => request<{ request: { id: string; username: string; expires_at: string } }>('/workspace/members', { method: 'POST', body: JSON.stringify({ username }) }),
  respondToJoin: (id: string, decision: 'accept' | 'decline') => request<{ workspace: { id: string; name: string } } | void>(`/workspace/join-requests/${id}`, { method: 'POST', body: JSON.stringify({ decision }) }),
  removeMember: (id: number) => request<void>(`/workspace/members/${id}`, { method: 'DELETE' }),
  bankDetails: (signal?: AbortSignal) => request<BankDetails>('/workspace/bank-details', { signal }),
  saveBankDetails: (details: BankDetails) => request<BankDetails>('/workspace/bank-details', { method: 'PUT', body: JSON.stringify(details) }),
  sellerDetails: (signal?: AbortSignal) => request<SellerDetails>('/workspace/seller-details', { signal }),
  saveSellerDetails: (details: SellerDetails) => request<SellerDetails>('/workspace/seller-details', { method: 'PUT', body: JSON.stringify(details) }),
  preview: (signal?: AbortSignal) => request<PreviewData>('/workspace/preview', { signal }),
};

export type Provider = { id: string; name: string; configured: boolean };
export type SignInMethods = { password: boolean; recent_auth: boolean; providers: string[] };
