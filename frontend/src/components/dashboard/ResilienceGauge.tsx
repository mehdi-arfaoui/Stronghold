import { useMemo, useEffect, useState } from 'react';
import { RESILIENCE_THRESHOLDS } from '@/lib/constants';

interface ResilienceGaugeProps {
  score: number;
  size?: number;
  showLabel?: boolean;
}

export function ResilienceGauge({ score, size = 200, showLabel = true }: ResilienceGaugeProps) {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    setAnimatedScore(0);
    const raf = requestAnimationFrame(() => setAnimatedScore(score ?? 0));
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const { color, circumference, offset } = useMemo(() => {
    const radius = (size - 20) / 2;
    const c = 2 * Math.PI * radius;
    const clampedScore = Math.max(0, Math.min(100, animatedScore ?? 0));
    const o = c - (clampedScore / 100) * c;

    let col: string;
    if (clampedScore >= RESILIENCE_THRESHOLDS.HIGH) {
      col = 'hsl(142 76% 36%)';
    } else if (clampedScore >= RESILIENCE_THRESHOLDS.MEDIUM) {
      col = 'hsl(38 92% 50%)';
    } else {
      col = 'hsl(0 84% 60%)';
    }

    return { color: col, circumference: c, offset: o };
  }, [animatedScore, size]);

  const center = size / 2;
  const radius = (size - 20) / 2;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="hsl(220 13% 91%)"
          strokeWidth="10"
        />
        {/* Score arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
          style={{
            '--gauge-circumference': circumference,
            '--gauge-offset': offset,
          } as React.CSSProperties}
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold" style={{ color }}>
          {Math.round(animatedScore ?? 0)}
        </span>
        {showLabel && <span className="text-sm text-muted-foreground">/100</span>}
      </div>
    </div>
  );
}
