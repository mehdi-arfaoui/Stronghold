import type { ApiScanSummary } from '@stronghold-dr/core';
import { Link } from 'react-router-dom';

import { formatDateTime, formatRegions } from '@/lib/utils';

export function ScanHistory({
  scans,
}: {
  readonly scans: readonly ApiScanSummary[];
}): JSX.Element {
  return (
    <section className="panel p-6">
      <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Scan history</p>
      <div className="mt-4 space-y-3">
        {scans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No previous scans yet.</p>
        ) : (
          scans.map((scan) => (
            <article key={scan.id} className="panel-elevated p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Link to={`/report/${scan.id}`} className="font-medium text-foreground transition-colors duration-150 hover:text-accent">
                    {formatDateTime(scan.createdAt)}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">{formatRegions(scan.regions)}</p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <div>{scan.status}</div>
                  <div className="text-foreground">{scan.score == null ? 'N/A' : `${Math.round(scan.score)} / ${scan.grade ?? 'N/A'}`}</div>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
