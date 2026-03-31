import { Moon, Sun } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { PAGE_TITLES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

function resolveTitle(pathname: string): string {
  const matchedEntry = Object.entries(PAGE_TITLES).find(([path]) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path),
  );
  return matchedEntry?.[1] ?? 'Stronghold';
}

export function Header(): JSX.Element {
  const location = useLocation();
  const currentScanId = useAppStore((state) => state.currentScanId);
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);

  return (
    <header className="flex items-center justify-between border-b border-border px-8 py-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-subtle-foreground">Stronghold</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          {resolveTitle(location.pathname)}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="rounded-full border border-border bg-elevated px-3 py-1 text-xs text-muted-foreground">
          {currentScanId ? `Current scan: ${currentScanId.slice(0, 8)}` : 'No active scan selected'}
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className={cn(
            'rounded-full border border-border p-2 transition-colors duration-150',
            'bg-elevated text-foreground hover:bg-muted',
          )}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
