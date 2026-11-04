export default function ProviderIcon({ provider }: { provider: string }) {
  if (provider === 'google') return <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z" />
    <path fill="#34a853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.12H3.05v2.59A10 10 0 0 0 12 22Z" />
    <path fill="#fbbc05" d="M6.39 13.92a6 6 0 0 1 0-3.84V7.49H3.05a10 10 0 0 0 0 9.02l3.34-2.59Z" />
    <path fill="#ea4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.34 2.59C7.18 7.72 9.39 5.96 12 5.96Z" />
  </svg>;
  if (provider === 'github') return <svg className="provider-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.94-2.65c3.14-.35 6.44-1.54 6.44-7A5.4 5.4 0 0 0 19 4.7 5 5 0 0 0 18.91 1S17.73.65 15 2.48a13.4 13.4 0 0 0-7 0C5.27.65 4.09 1 4.09 1A5 5 0 0 0 4 4.7a5.4 5.4 0 0 0-1.5 3.75c0 5.42 3.3 6.61 6.44 7A3.4 3.4 0 0 0 8 18.1V22" />
  </svg>;
  if (provider === 'microsoft') return <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#f25022" d="M2 2h9v9H2z" /><path fill="#7fba00" d="M13 2h9v9h-9z" />
    <path fill="#00a4ef" d="M2 13h9v9H2z" /><path fill="#ffb900" d="M13 13h9v9h-9z" />
  </svg>;
  return null;
}
