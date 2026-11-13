import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dashboard, type DashboardData } from './api';
import { money as dealMoney, stages } from '../deals/api';
import { auth, reportingCurrencies, type ReportingCurrency } from '../../api/client';
import MyTasks from './MyTasks';
import './dashboard.css';

function amount(value: string, currency: string) {
  const [whole, fraction = ''] = value.split('.');
  const number = `${new Intl.NumberFormat('en-US').format(BigInt(whole))}${fraction && !/^0+$/.test(fraction) ? `.${fraction}` : ''}`;
  return currency === 'USD' ? `$${number}` : currency === 'EUR' ? `€${number}` : `${number} ${currency}`;
}

function label(period: string, unit: 'month' | 'quarter') {
  const [year, month] = period.split('-').map(Number);
  return unit === 'quarter' ? `Q${Math.floor((month - 1) / 3) + 1} ${year}` : new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export default function DashboardPage({ onNavigate, reportingCurrency = 'USD', onReportingCurrencyChanged }: { onNavigate: (page: 'Deals' | 'Clients' | 'Tasks') => void; reportingCurrency?: ReportingCurrency; onReportingCurrencyChanged?: (currency: ReportingCurrency) => void }) {
  const [currency, setCurrency] = useState<ReportingCurrency>(reportingCurrency);
  const [currencyError, setCurrencyError] = useState('');
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [period, setPeriod] = useState<'month' | 'quarter'>('month');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    dashboard.get(currency, period, controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : 'Unable to load the dashboard.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [currency, period, revision]);

  const rows = data?.revenue_rows.map(row => ({ name: label(row.period, period), revenue: Number(row.revenue ?? 0), exact: row.revenue })) ?? [];
  const hasRevenue = data?.revenue !== null && data?.revenue_rows.some(row => Number(row.revenue) !== 0);
  const dealCount = data?.deal_counts.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const missing = data ? [...new Set(Object.values(data.fx.missing).flat())] : [];

  async function changeCurrency(next: ReportingCurrency) {
    setSavingCurrency(true); setCurrencyError('');
    try {
      await auth.updateReportingCurrency(next);
      setCurrency(next);
      onReportingCurrencyChanged?.(next);
    } catch {
      setCurrencyError('Unable to save your reporting currency. Please retry.');
    } finally {
      setSavingCurrency(false);
    }
  }

  return <section className="dashboard-page" aria-label="Dashboard">
    <div className="dashboard-toolbar"><p className="muted">A snapshot of your business</p><label className="dashboard-currency"><span>Currency</span><select aria-label="Dashboard currency" value={currency} disabled={savingCurrency} onChange={event => changeCurrency(event.target.value as ReportingCurrency)}>{reportingCurrencies.map(item => <option key={item}>{item}</option>)}</select></label></div>
    {currencyError && <p role="alert" className="notice error">{currencyError}</p>}
    {error && <div className="notice error" role="alert">{error} <button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {loading && <p role="status">Loading dashboard…</p>}
    {!loading && data && <>
      {missing.length > 0 && <p role="status" className="notice error">ECB rates are unavailable for {missing.join(', ')}. Affected totals are hidden until rates are imported; amounts in original currencies remain unchanged.</p>}
      <div className="dashboard-kpis">
        <article className="panel"><span>Active pipeline</span><strong>{data.pipeline_value === null ? 'Rate unavailable' : amount(data.pipeline_value, currency)}</strong><small>{data.fx.pipeline_rate_date ? `ECB rate: ${data.fx.pipeline_rate_date}` : `${currency} · New lead, negotiation and in progress`}</small></article>
        <article className="panel"><span>Win rate</span><strong>{data.win_rate === null ? 'N/A' : `${data.win_rate.replace(/\.00$/, '')}%`}</strong><small>Paid deals vs. paid and archived lost deals</small></article>
        <article className="panel"><span>Average deal size</span><strong>{data.average_deal_size === null ? data.fx.missing.average_deal_size.length ? 'Rate unavailable' : 'N/A' : amount(data.average_deal_size, currency)}</strong><small>{data.fx.average_rate_dates.length ? 'ECB rates fixed at payment dates' : `${currency} · Across paid deals`}</small></article>
        <article className="panel"><span>Revenue</span><strong>{data.revenue === null ? 'Rate unavailable' : amount(data.revenue, currency)}</strong><small>{data.fx.revenue_rate_dates.length ? 'ECB rates fixed at payment dates' : `${currency} · Paid invoices in the displayed period`}</small></article>
      </div>
      <div className="dashboard-main-grid">
        <section className="panel dashboard-chart-panel"><div className="dashboard-section-heading"><div><h2>Revenue overview</h2><p className="muted">Paid invoices from {label(data.revenue_rows[0].period, period)} through {label(data.revenue_rows[data.revenue_rows.length - 1].period, period)}</p></div><div className="dashboard-period" role="group" aria-label="Revenue period"><button aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>Monthly</button><button aria-pressed={period === 'quarter'} onClick={() => setPeriod('quarter')}>Quarterly</button></div></div>
          {data.revenue === null ? <p className="dashboard-empty">Revenue is unavailable until the missing ECB rates are imported.</p> : hasRevenue ? <div className="dashboard-chart" role="img" aria-label={`${period === 'month' ? 'Monthly' : 'Quarterly'} paid invoice revenue in ${currency}`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} /><YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={value => currency === 'USD' || currency === 'EUR' ? `${currency === 'EUR' ? '€' : '$'}${new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value)}` : `${new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value)} ${currency}`} /><Tooltip formatter={(_value, _name, item) => amount(item.payload.exact, currency)} /><Area type="monotone" dataKey="revenue" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={3} /></AreaChart></ResponsiveContainer></div> : <p className="dashboard-empty">No paid invoices in this period.</p>}
        </section>
        <section className="panel dashboard-pipeline"><div className="dashboard-section-heading"><div><h2>Pipeline at a glance</h2><p className="muted">Deal stages in {currency}</p></div></div><strong className="dashboard-deal-count">{dealCount} deals</strong>{stages.map(stage => { const count = data.deal_counts.find(row => row.status === stage.id)?.count ?? 0; return <div className="dashboard-stage" key={stage.id}><div><span>{stage.label}</span><strong>{count}</strong></div><div className="dashboard-stage-track"><i style={{ width: `${dealCount ? count / dealCount * 100 : 0}%` }} /></div></div>; })}</section>
      </div>
      <section className="panel dashboard-recent"><div className="dashboard-section-heading"><div><h2>On your radar</h2><p className="muted">Upcoming active deals</p></div><button className="secondary" onClick={() => onNavigate('Deals')}>View all deals</button></div>{data.recent_deals.length ? <div className="dashboard-table-wrap"><table><thead><tr><th>Deal / client</th><th>Status</th><th>Deadline</th><th>Value</th></tr></thead><tbody>{data.recent_deals.map(deal => <tr key={deal.id}><td><button className="dashboard-deal-link" onClick={() => onNavigate('Deals')}>{deal.title}</button><small>{deal.client__company || deal.client__name}</small></td><td>{stages.find(stage => stage.id === deal.status)?.label}</td><td>{deal.deadline ? new Date(deal.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No deadline'}</td><td>{dealMoney(deal.amount, deal.currency)}</td></tr>)}</tbody></table></div> : <p className="dashboard-empty">No active deals. <button className="dashboard-deal-link" onClick={() => onNavigate('Deals')}>Explore deals</button></p>}</section>
      <MyTasks onNavigate={() => onNavigate('Tasks')} />
    </>}
  </section>;
}
