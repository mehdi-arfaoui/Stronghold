import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useScans } from '@/hooks/use-scans';
import { useAppStore } from '@/store/app-store';

export function AppLayout(): JSX.Element {
  const theme = useAppStore((state) => state.theme);
  const { data } = useScans({ limit: 1 });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const latestScan = data?.scans[0] ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-[288px_minmax(0,1fr)]">
        <Sidebar
          isLoading={!data}
          summary={
            latestScan
              ? {
                  score: latestScan.score,
                  grade: latestScan.grade,
                  reportPath: `/report/${latestScan.id}`,
                }
              : null
          }
        />
        <div className="min-w-0">
          <Header />
          <main className="p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
