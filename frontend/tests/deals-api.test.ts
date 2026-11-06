import { beforeEach, expect, it, vi } from 'vitest';
import { request } from '../src/api/client';
import { deals, type Deal } from '../src/features/deals/api';

vi.mock('../src/api/client', async importOriginal => ({ ...await importOriginal<typeof import('../src/api/client')>(), request: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('loads every board page, keeps currencies separate and de-duplicates changing pages', async () => {
  const first = { id: 'deal-1', amount: '1.23', currency: 'EUR' };
  const second = { id: 'deal-2', amount: '4.56', currency: 'USD' };
  const totals = [{ status: 'new_lead', currency: 'EUR', count: 1, amount: '1.23' }, { status: 'new_lead', currency: 'USD', count: 1, amount: '4.56' }];
  vi.mocked(request).mockResolvedValueOnce({ results: [first], totals, next: '/api/v1/deals?page=2', count: 2 }).mockResolvedValueOnce({ results: [first, second], totals, next: null, count: 2 });
  const signal = new AbortController().signal;
  const result = await deals.list({ search: 'Studio & Co', currency: '', status: 'new_lead' }, signal);
  expect(result.results).toEqual([first, second]);
  expect(result.totals).toEqual(totals);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith(expect.stringContaining('page=2'), { signal });
  expect(vi.mocked(request).mock.calls[0][0]).toContain('search=Studio+%26+Co');
});

it('loads all client picker pages without following arbitrary response URLs', async () => {
  vi.mocked(request).mockResolvedValueOnce({ results: [{ id: 'c1' }], next: 'https://untrusted.example/' }).mockResolvedValueOnce({ results: [{ id: 'c2' }], next: null });
  expect(await deals.clients()).toEqual([{ id: 'c1' }, { id: 'c2' }]);
  expect(request).toHaveBeenLastCalledWith('/clients?page_size=100&page=2', { signal: undefined });
});

it('sends observed versions and exact decimal strings through the shared session client', async () => {
  vi.mocked(request).mockResolvedValue(undefined);
  const deal = { id: 'record', version: 7 } as Deal;
  const values = { title: 'Project', client: 'client', status: 'new_lead' as const, amount: '9999999999999999.99', currency: 'EUR', deadline: null, outcome: 'none' as const };
  await deals.update(deal, values);
  expect(request).toHaveBeenLastCalledWith('/deals/record', { method: 'PATCH', body: JSON.stringify({ ...values, version: 7 }) });
  await deals.status(deal, 'archived', 'cancelled');
  expect(request).toHaveBeenLastCalledWith('/deals/record/status', { method: 'PATCH', body: JSON.stringify({ status: 'archived', outcome: 'cancelled', version: 7 }) });
  await deals.remove(deal);
  expect(request).toHaveBeenLastCalledWith('/deals/record', { method: 'DELETE', body: JSON.stringify({ version: 7 }) });
});
