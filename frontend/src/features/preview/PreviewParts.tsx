import { type ReactNode } from 'react';
import { stages, type PreviewClient } from './data';

export const pages = ['Dashboard', 'Deals', 'Clients', 'Invoices', 'Settings'] as const;
export type Page = typeof pages[number];
export type Editor = 'client' | 'deal' | 'invoice' | null;
export type PreviewTheme = 'system' | 'light' | 'dark';
export type PreviewProfile = { name: string; username: string; email: string; avatar: string };
export const currentPage = () => pages.find(page => window.location.hash === `#/${page.toLowerCase()}`) ?? 'Deals';

export function Icon({ name }: { name: 'search' | 'plus' | 'arrow' | 'grid' | 'table' | 'calendar' | 'file' | 'check' | 'settings' }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    grid: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="14" rx="1" /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 4v16" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></>,
    file: <><path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--surface)" /><circle cx="16" cy="12" r="2" fill="var(--surface)" /><circle cx="10" cy="18" r="2" fill="var(--surface)" /></>,
  };
  return <svg className="pv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Avatar({ client, small = false }: { client: PreviewClient; small?: boolean }) {
  return <span className={`pv-avatar tone-${client.color} ${small ? 'small' : ''}`} aria-hidden="true">{client.initials}</span>;
}

export function Badge({ status }: { status: string }) {
  const stage = stages.find(item => item.id === status);
  return <span className={`pv-badge tone-${stage?.color ?? (status === 'sent' ? 'blue' : status === 'draft' ? 'gray' : 'green')}`}><i />{stage?.label ?? status[0].toUpperCase() + status.slice(1)}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="pv-empty"><span>◇</span><p>{children}</p><small>Try another search or filter.</small></div>;
}

export function UserAvatar({ profile, large = false }: { profile: PreviewProfile; large?: boolean }) {
  return <span className={`pv-user-avatar ${large ? 'large' : ''}`} aria-label={`${profile.name} avatar`}>{profile.avatar ? <img src={profile.avatar} alt="" /> : profile.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span>;
}

