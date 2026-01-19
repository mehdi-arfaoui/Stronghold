import { EventEmitter } from "events";

export type RiskMatrixUpdateEvent = {
  tenantId: string;
  source: "vulnerability-scan" | "manual";
  updatedAt: Date;
  summary?: Record<string, unknown> | null;
};

const matrixEmitter = new EventEmitter();
matrixEmitter.setMaxListeners(50);

export function emitRiskMatrixUpdate(event: RiskMatrixUpdateEvent) {
  matrixEmitter.emit("risk-matrix:update", event);
}

export function onRiskMatrixUpdate(
  handler: (event: RiskMatrixUpdateEvent) => void
): () => void {
  matrixEmitter.on("risk-matrix:update", handler);
  return () => matrixEmitter.off("risk-matrix:update", handler);
}
