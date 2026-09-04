'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';

export type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const storageKey = 'settlement-trace-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [systemDark, setSystemDark] = useState(() => typeof window === 'undefined' || window.matchMedia('(prefers-color-scheme: dark)').matches);
  const resolvedTheme: ResolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    const next = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    const frame = requestAnimationFrame(() => setPreferenceState(next));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const nextSystemDark = media.matches;
      const next = preference === 'system' ? (nextSystemDark ? 'dark' : 'light') : preference;
      document.documentElement.classList.toggle('dark', next === 'dark');
      document.documentElement.classList.toggle('light', next === 'light');
      document.documentElement.dataset.theme = next;
      document.documentElement.dataset.themePreference = preference;
      document.documentElement.style.colorScheme = next;
    };
    const handleChange = () => { setSystemDark(media.matches); apply(); };
    apply();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [preference]);

  const value = useMemo(() => ({
    preference,
    resolvedTheme,
    setPreference(next: ThemePreference) {
      localStorage.setItem(storageKey, next);
      setPreferenceState(next);
    },
  }), [preference, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}

const options = [
  { id: 'light' as const, label: 'Light', icon: Sun },
  { id: 'dark' as const, label: 'Dark', icon: Moon },
  { id: 'system' as const, label: 'System', icon: Laptop },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <fieldset className="theme-toggle" aria-label="Color theme">
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={preference === id ? 'active' : ''}
          aria-pressed={preference === id}
          aria-label={`Use ${label.toLowerCase()} theme`}
          title={`${label} theme`}
          onClick={() => setPreference(id)}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </fieldset>
  );
}
