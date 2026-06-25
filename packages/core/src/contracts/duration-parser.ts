import type { ParsedDuration } from './contract-types.js';

const HOURS_RE = /^([1-9]\d*)h/u;
const MINUTES_RE = /^([1-9]\d*)m/u;
const SECONDS_RE = /^([1-9]\d*)s/u;

const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

interface DurationPart {
  readonly value: number;
  readonly remaining: string;
}

export class DurationParseError extends Error {
  public readonly input: string;

  public constructor(input: string, reason: string) {
    super(`Invalid duration "${input}": ${reason}`);
    this.name = 'DurationParseError';
    this.input = input;
  }
}

/**
 * Parses a strict human-readable duration into milliseconds.
 */
export function parseDuration(input: string): ParsedDuration {
  if (input.length === 0) {
    throw new DurationParseError(input, 'duration cannot be empty.');
  }

  let remaining = input;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let matchedAnyPart = false;

  const hoursPart = consumeDurationPart(HOURS_RE, remaining);
  if (hoursPart) {
    hours = hoursPart.value;
    remaining = hoursPart.remaining;
    matchedAnyPart = true;
  }

  const minutesPart = consumeDurationPart(MINUTES_RE, remaining);
  if (minutesPart) {
    minutes = minutesPart.value;
    remaining = minutesPart.remaining;
    matchedAnyPart = true;
  }

  const secondsPart = consumeDurationPart(SECONDS_RE, remaining);
  if (secondsPart) {
    seconds = secondsPart.value;
    remaining = secondsPart.remaining;
    matchedAnyPart = true;
  }

  if (!matchedAnyPart) {
    throw new DurationParseError(
      input,
      'use positive integer hour, minute, or second components such as 1h, 30m, or 45s.',
    );
  }

  if (remaining.length > 0) {
    throw new DurationParseError(
      input,
      `unsupported, duplicate, or out-of-order component "${remaining}".`,
    );
  }

  const totalMs =
    hours * MILLISECONDS_PER_HOUR +
    minutes * MILLISECONDS_PER_MINUTE +
    seconds * MILLISECONDS_PER_SECOND;

  return {
    raw: input,
    totalMs,
    hours,
    minutes,
    seconds,
  };
}

export function tryParseDuration(input: string): ParsedDuration | null {
  try {
    return parseDuration(input);
  } catch {
    return null;
  }
}

export function formatDuration(duration: ParsedDuration): string {
  const parts: string[] = [];

  if (duration.hours > 0) {
    parts.push(`${duration.hours}h`);
  }
  if (duration.minutes > 0) {
    parts.push(`${duration.minutes}m`);
  }
  if (duration.seconds > 0) {
    parts.push(`${duration.seconds}s`);
  }

  if (parts.length === 0) {
    throw new DurationParseError(duration.raw, 'duration must be greater than zero.');
  }

  return parts.join('');
}

function consumeDurationPart(pattern: RegExp, remaining: string): DurationPart | null {
  const match = pattern.exec(remaining);
  if (!match) {
    return null;
  }

  const rawValue = match[1] as string;
  const matchedText = match[0] as string;

  return {
    value: Number.parseInt(rawValue, 10),
    remaining: remaining.slice(matchedText.length),
  };
}
