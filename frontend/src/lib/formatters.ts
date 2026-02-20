export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h${String(mins).padStart(2, '0')}`;
}

export function formatScore(score: number): string {
  return `${Math.round(score)}/100`;
}

export function formatPercentage(value: number): string {
  return `${Math.round(value * 100) / 100}%`;
}

export function formatCurrency(amount: number, currency: string, locale = 'fr-FR'): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeCurrency =
    typeof currency === 'string' && currency.trim().length > 0
      ? currency.toUpperCase()
      : 'EUR';
  const useCompact = Math.abs(safeAmount) >= 1_000;
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: safeCurrency,
    maximumFractionDigits: useCompact ? 1 : 0,
    ...(useCompact ? { notation: 'compact', compactDisplay: 'short' } : {}),
  };

  try {
    return new Intl.NumberFormat(locale, options).format(safeAmount);
  } catch {
    return new Intl.NumberFormat(locale, {
      ...options,
      currency: 'EUR',
    }).format(safeAmount);
  }
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return "a l'instant";
  if (diffMin < 60) return `il y a ${diffMin}min`;
  if (diffHours < 24) return `il y a ${diffHours}h`;
  if (diffDays < 7) return `il y a ${diffDays}j`;
  return d.toLocaleDateString('fr-FR');
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: undefined,
    hour: '2-digit',
    minute: '2-digit',
  });
}
