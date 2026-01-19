import { EventEmitter } from "events";

export type DiscoveryProgressEvent = {
  tenantId: string;
  jobId: string;
  status?: string | null;
  step?: string | null;
  progress?: number | null;
  summary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  completedAt?: Date | null;
};

const progressEmitter = new EventEmitter();
progressEmitter.setMaxListeners(50);

export function emitDiscoveryProgress(event: DiscoveryProgressEvent) {
  progressEmitter.emit("progress", event);
}

export function onDiscoveryProgress(
  handler: (event: DiscoveryProgressEvent) => void
): () => void {
  progressEmitter.on("progress", handler);
  return () => progressEmitter.off("progress", handler);
}
