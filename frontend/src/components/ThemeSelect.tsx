import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';

export default function ThemeSelect({ icons = false }: { icons?: boolean }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('theme');
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch { return 'system'; }
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme; };
    apply();
    try { localStorage.setItem('theme', theme); } catch {}
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  if (icons) return <div className="theme-switch" role="group" aria-label="Theme">
    {(['system', 'light', 'dark'] as const).map(mode => <button key={mode} type="button" className="theme-option" aria-label={`${mode[0].toUpperCase() + mode.slice(1)} theme`}
      title={`${mode[0].toUpperCase() + mode.slice(1)} theme`} aria-pressed={theme === mode} onClick={() => setTheme(mode)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {mode === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>
          : mode === 'dark' ? <path d="M20.9 13.3A9 9 0 0 1 10.7 3.1a9 9 0 1 0 10.2 10.2Z" />
            : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>}
      </svg>
    </button>)}
  </div>;

  return <label className="theme-control">Theme
    <select value={theme} onChange={event => setTheme(event.target.value as Theme)}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
  </label>;
}
