const DEFAULT_DISCOVERY_WHEEL_SENSITIVITY = 0.3;
const DEFAULT_DISCOVERY_MIN_ZOOM = 0.05;
const DEFAULT_DISCOVERY_MAX_ZOOM = 2.4;

function readPositiveEnvNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function readFirstPositiveEnvNumber(candidates: Array<string | undefined>, fallback: number): number {
  for (const candidate of candidates) {
    const value = readPositiveEnvNumber(candidate, Number.NaN);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

const env = import.meta.env as Record<string, string | undefined>;

const wheelSensitivity = readFirstPositiveEnvNumber(
  [env.VITE_DISCOVERY_WHEEL_SENSITIVITY, env.REACT_APP_DISCOVERY_WHEEL_SENSITIVITY],
  DEFAULT_DISCOVERY_WHEEL_SENSITIVITY,
);
const minZoom = readFirstPositiveEnvNumber(
  [env.VITE_DISCOVERY_MIN_ZOOM, env.REACT_APP_DISCOVERY_MIN_ZOOM],
  DEFAULT_DISCOVERY_MIN_ZOOM,
);
const maxZoom = readFirstPositiveEnvNumber(
  [env.VITE_DISCOVERY_MAX_ZOOM, env.REACT_APP_DISCOVERY_MAX_ZOOM],
  DEFAULT_DISCOVERY_MAX_ZOOM,
);

export const DISCOVERY_GRAPH_CONFIG = {
  wheelSensitivity,
  minZoom: Math.min(minZoom, maxZoom),
  maxZoom: Math.max(maxZoom, minZoom),
} as const;
