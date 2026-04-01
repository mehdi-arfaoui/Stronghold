import { redact, type RedactionOptions } from './redaction-engine.js';

type CloneTarget = Record<string, unknown> | unknown[];

export function redactObject<TValue>(
  value: TValue,
  options: RedactionOptions = {},
): TValue {
  if (options.level === 'none') {
    return structuredClone(value);
  }

  if (typeof value === 'string') {
    return redact(value, options) as TValue;
  }

  if (!isObjectLike(value)) {
    return value;
  }

  if (isFlatRecord(value)) {
    return redactFlatRecord(value, options) as TValue;
  }

  const rootClone = createCloneContainer(value);
  const visited = new WeakMap<object, object>([[value as object, rootClone]]);
  const queue: Array<{ readonly source: object; readonly target: CloneTarget }> = [
    { source: value as object, target: rootClone },
  ];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    if (Array.isArray(current.source) && Array.isArray(current.target)) {
      const targetArray = current.target as unknown[];
      for (let index = 0; index < current.source.length; index += 1) {
        targetArray[index] = cloneValue(current.source[index], options, queue, visited);
      }
      continue;
    }

    const targetRecord = current.target as Record<string, unknown>;
    const keys = Object.keys(current.source);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (!key) {
        continue;
      }
      targetRecord[key] = cloneValue(
        (current.source as Record<string, unknown>)[key],
        options,
        queue,
        visited,
      );
    }
  }

  return rootClone as TValue;
}

function cloneValue(
  value: unknown,
  options: RedactionOptions,
  queue: Array<{ readonly source: object; readonly target: CloneTarget }>,
  visited: WeakMap<object, object>,
): unknown {
  if (typeof value === 'string') {
    return redact(value, options);
  }

  if (!isObjectLike(value)) {
    return value;
  }

  const existing = visited.get(value);
  if (existing) {
    return existing;
  }

  const clone = createCloneContainer(value);
  visited.set(value, clone);
  queue.push({ source: value, target: clone });
  return clone;
}

function createCloneContainer(value: object): CloneTarget {
  return Array.isArray(value) ? [] : {};
}

function isObjectLike(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object';
}

function isFlatRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const values = Object.values(value);
  for (let index = 0; index < values.length; index += 1) {
    if (isObjectLike(values[index])) {
      return false;
    }
  }

  return true;
}

function redactFlatRecord(
  value: Record<string, unknown>,
  options: RedactionOptions,
): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  const keys = Object.keys(value);

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (!key) {
      continue;
    }
    const item = value[key];
    clone[key] = typeof item === 'string' ? redact(item, options) : item;
  }

  return clone;
}
