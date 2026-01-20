import { Prisma } from "@prisma/client";

const isPlainObject = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function isJsonValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): value is Prisma.InputJsonValue {
  if (value === null) return false;
  if (typeof value === "string") return true;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry, seen));
  }
  if (typeof value === "object") {
    if (!isPlainObject(value)) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.entries(value).every(
      ([, entry]) => entry !== undefined && isJsonValue(entry, seen)
    );
  }
  return false;
}

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  if (value === null) {
    throw new Error("Invalid JSON value for Prisma: null is not allowed.");
  }
  if (isJsonValue(value)) return value;
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("Value cannot be serialized to JSON.");
    }
    const parsed = JSON.parse(serialized) as unknown;
    if (!isJsonValue(parsed)) {
      throw new Error("Serialized value is not valid JSON.");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON error";
    throw new Error(`Invalid JSON value for Prisma: ${message}`);
  }
}
