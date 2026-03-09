import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { recommendationsApi } from '@/api/recommendations.api';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

const COLORS = ['#22c55e', '#ef4444', '#64748b'];

export function RecommendationsStatusWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'recommendations-status'],
    queryFn: async () => (await recommendationsApi.getAll()).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const recommendations = query.data;

  const data = useMemo(() => {
    let validated = 0;
    let rejected = 0;
    let pending = 0;

    for (const recommendation of recommendations) {
      if (recommendation.status === 'validated') {
        validated += 1;
      } else if (recommendation.status === 'rejected') {
        rejected += 1;
      } else {
        pending += 1;
      }
    }

    return [
      { name: 'Validées', value: validated },
      { name: 'Rejetées', value: rejected },
      { name: 'En attente', value: pending },
    ];
  }, [recommendations]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="h-[170px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={42}
              outerRadius={70}
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {data.map((item, index) => (
          <div key={item.name} className="rounded border px-2 py-1">
            <p style={{ color: COLORS[index] }}>{item.value}</p>
            <p className="text-muted-foreground">{item.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
