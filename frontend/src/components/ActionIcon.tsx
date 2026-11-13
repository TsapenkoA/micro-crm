const paths = {
  add: 'M12 5v14 M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M17 17l4 4',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  refresh: 'M20 11a8 8 0 1 0-2.3 6 M20 4v7h-7',
  check: 'M5 12l5 5L20 7',
  send: 'M21 3 3 10l8 3 3 8 7-18Z M11 13l10-10',
  close: 'M5 5l14 14 M19 5 5 19',
} as const;

export default function ActionIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="action-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
