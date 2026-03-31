import type { Logger } from '@stronghold-dr/core';

import type { ServerConfig } from '../config/env.js';
import { toError } from '../errors/server-error.js';

const LOG_LEVEL_RANK: Record<ServerConfig['logLevel'], number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class ServerLogger implements Logger {
  public constructor(private readonly config: Pick<ServerConfig, 'logLevel' | 'nodeEnv'>) {}

  public debug(message: string, context?: Record<string, unknown>): void {
    this.emit('debug', message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.emit('info', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.emit('warn', message, context);
  }

  public error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const resolvedError = error === undefined ? undefined : toError(error);
    this.emit('error', message, context, resolvedError);
  }

  private emit(
    level: ServerConfig['logLevel'],
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[this.config.logLevel]) {
      return;
    }

    const payload = {
      level,
      message,
      ...(error
        ? {
            error: error.message,
            ...(this.config.nodeEnv === 'development' ? { stack: error.stack } : {}),
          }
        : {}),
      ...context,
      timestamp: new Date().toISOString(),
    };
    const serialized = JSON.stringify(payload);

    if (level === 'error') {
      // Intentional: this IS the logger implementation.
      // eslint-disable-next-line no-console
      console.error(serialized);
      return;
    }

    if (level === 'warn') {
      // Intentional: this IS the logger implementation.
      // eslint-disable-next-line no-console
      console.warn(serialized);
      return;
    }

    // Intentional: this IS the logger implementation.
    // eslint-disable-next-line no-console
    console.log(serialized);
  }
}
