import type { DRPlan } from '@stronghold-dr/core';

import { ComponentCard } from './ComponentCard';

export function DRPTimeline({
  plan,
}: {
  readonly plan: DRPlan;
}): JSX.Element {
  return (
    <div className="space-y-8">
      {plan.services.map((service, index) => (
        <section key={service.name} className="relative pl-10">
          <div className="absolute left-0 top-2 h-full w-px bg-border-strong" />
          <div className="absolute left-[-6px] top-2 h-3 w-3 rounded-full bg-accent" />
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Step {index + 1}</p>
            <h2 className="mt-1 text-xl font-semibold text-foreground">{service.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {service.criticality} criticality | target RTO {service.rtoTarget} | target RPO {service.rpoTarget}
            </p>
          </div>
          <div className="space-y-4">
            {service.components.map((component) => (
              <ComponentCard key={component.resourceId} component={component} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
