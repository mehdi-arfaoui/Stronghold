import type { Logger } from '@stronghold-dr/core';

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  stream.write(`${line}\n`);
}

function formatContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }
  return ` ${JSON.stringify(context)}`;
}

export class ConsoleLogger implements Logger {
  public readonly verbose: boolean;

  public constructor(verbose = false) {
    this.verbose = verbose;
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    if (!this.verbose) {
      return;
    }
    writeLine(process.stdout, `[debug] ${message}${formatContext(context)}`);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    writeLine(process.stdout, `${message}${formatContext(context)}`);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    writeLine(process.stderr, `${message}${formatContext(context)}`);
  }

  public error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const suffix = error instanceof Error && this.verbose ? ` ${error.stack ?? error.message}` : '';
    writeLine(process.stderr, `${message}${suffix}${formatContext(context)}`);
  }
}
