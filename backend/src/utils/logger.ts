type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY_PATTERN = /(password|secret|token|api[_-]?key|authorization|keyCiphertext|keyIv|keyTag)/i;
const SENSITIVE_STRING_PATTERN =
  /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|secret|token|api[_-]?key)\s*[:=]\s*[^,\s]+)/i;
const REDACTED_VALUE = "[REDACTED]";

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return SENSITIVE_STRING_PATTERN.test(value) ? REDACTED_VALUE : value;
  }
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

function normalizeLogArgs(args: unknown[]): { message: string; meta?: unknown } {
  if (args.length === 0) {
    return { message: "" };
  }

  const [first, ...rest] = args;
  const message = typeof first === "string" ? first : String(first);

  if (rest.length === 0) {
    return { message };
  }

  if (rest.length === 1) {
    return { message, meta: rest[0] };
  }

  return { message, meta: rest };
}

function write(level: LogLevel, ...args: unknown[]) {
  const { message, meta } = normalizeLogArgs(args);
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
  info(...args: unknown[]) {
    write("info", ...args);
  },
  warn(...args: unknown[]) {
    write("warn", ...args);
  },
  error(...args: unknown[]) {
    write("error", ...args);
  },
};
