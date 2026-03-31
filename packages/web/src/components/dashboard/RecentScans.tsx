import type { ApiScanSummary } from '@stronghold-dr/core';
import { Link } from 'react-router-dom';

import { formatDateTime, formatRegions } from '@/lib/utils';

export function RecentScans({
  scans,
}: {
  readonly scans: readonly ApiScanSummary[];
}): JSX.Element {
  return (
    <section className="panel p-6">
      <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Recent scans</p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <table className="min-w-full divide-y divide-border text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Regions</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {scans.slice(0, 5).map((scan) => (
              <tr key={scan.id} className="text-foreground transition-colors duration-150 hover:bg-elevated">
                <td className="px-4 py-3">
                  <Link to={`/report/${scan.id}`} className="font-medium transition-colors duration-150 hover:text-accent">
                    {formatDateTime(scan.createdAt)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatRegions(scan.regions)}</td>
                <td className="px-4 py-3">
                  {scan.score == null ? 'N/A' : `${Math.round(scan.score)} (${scan.grade ?? 'N/A'})`}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{scan.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
