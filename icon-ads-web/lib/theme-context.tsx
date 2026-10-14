'use client';

import { createContext, useContext, useEffect } from 'react';

// El panel usa una sola paleta (ICON, oscura — ver globals.css). Se deja el
// contexto por compatibilidad: siempre 'dark', y toggle no hace nada.
type Theme = 'light' | 'dark';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // La clase .dark activa las variantes dark: de Tailwind que usan las páginas.
    document.documentElement.classList.add('dark');
    try { localStorage.removeItem('theme'); } catch { /* ignore */ }
  }, []);

  return <ThemeContext.Provider value={{ theme: 'dark', toggle: () => {} }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
