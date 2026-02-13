type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY_PATTERN = /(password|secret|token|api[_-]?key|authorization|keyCiphertext|keyIv|keyTag)/i;
const REDACTED_VALUE = "[REDACTED]";

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return Object.fromEntries(
      entries.map(([key, nestedValue]) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return [key, REDACTED_VALUE];
        }
        return [key, sanitizeValue(nestedValue, depth + 1)];
      })
    );
  }
  return String(value);
}

function write(level: LogLevel, message: string, meta?: unknown) {
  const payload = {
    level,
    message,
    ...(meta !== undefined ? { meta: sanitizeValue(meta) } : {}),
    timestamp: new Date().toISOString(),
  };

  const line = `${JSON.stringify(payload)}\n`;
  if (level === "error") {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

export const appLogger = {
  info(message: string, meta?: unknown) {
    write("info", message, meta);
  },
  warn(message: string, meta?: unknown) {
    write("warn", message, meta);
  },
  error(message: string, meta?: unknown) {
    write("error", message, meta);
  },
};
