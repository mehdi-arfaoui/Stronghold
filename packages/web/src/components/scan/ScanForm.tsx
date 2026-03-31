import { type FormEvent, useMemo, useState } from 'react';

import { AWS_SERVICE_OPTIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function ScanForm({
  onSubmit,
  isSubmitting,
}: {
  readonly onSubmit: (input: {
    readonly provider: 'aws';
    readonly regions: readonly string[];
    readonly services?: readonly string[];
  }) => Promise<void>;
  readonly isSubmitting: boolean;
}): JSX.Element {
  const [regionsInput, setRegionsInput] = useState('eu-west-1, us-east-1');
  const [selectedServices, setSelectedServices] = useState<ReadonlySet<string>>(
    () => new Set(AWS_SERVICE_OPTIONS),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const regions = useMemo(
    () =>
      regionsInput
        .split(',')
        .map((region) => region.trim())
        .filter((region) => region.length > 0),
    [regionsInput],
  );

  const toggleService = (service: string): void => {
    setSelectedServices((current) => {
      const next = new Set(current);
      if (next.has(service)) {
        next.delete(service);
      } else {
        next.add(service);
      }
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (regions.length === 0) {
      setErrorMessage('At least one AWS region is required.');
      return;
    }

    setErrorMessage(null);
    await onSubmit({
      provider: 'aws',
      regions,
      services: selectedServices.size === AWS_SERVICE_OPTIONS.length ? undefined : [...selectedServices],
    });
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="panel p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Start a scan</p>
          <h2 className="mt-2 text-2xl font-semibold text-foreground">AWS infrastructure discovery</h2>
        </div>
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Starting scan...' : 'Start Scan'}
        </button>
      </div>

      <div className="mt-6 grid gap-6">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-foreground">Provider</span>
          <input
            value="aws"
            readOnly
            className="input-field cursor-default"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-medium text-foreground">Regions</span>
          <input
            value={regionsInput}
            onChange={(event) => setRegionsInput(event.target.value)}
            placeholder="eu-west-1, us-east-1"
            className="input-field"
          />
          <span className="text-xs text-subtle-foreground">Comma-separated AWS regions.</span>
        </label>
        <div className="grid gap-3">
          <div>
            <span className="text-sm font-medium text-foreground">Services</span>
            <p className="mt-1 text-xs text-subtle-foreground">Leave all checked for a full DR posture scan.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {AWS_SERVICE_OPTIONS.map((service) => (
              <button
                key={service}
                type="button"
                onClick={() => toggleService(service)}
                className={cn(
                  'rounded-xl border px-3 py-2 text-sm transition-colors duration-150',
                  selectedServices.has(service)
                    ? 'border-accent bg-accent-soft text-accent-soft-foreground'
                    : 'border-border bg-elevated text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {service}
              </button>
            ))}
          </div>
        </div>
      </div>

      {errorMessage ? <p className="mt-4 text-sm text-danger-foreground">{errorMessage}</p> : null}
    </form>
  );
}
