export class CliError extends Error {
  public readonly exitCode: number;
  public readonly cause?: unknown;

  public constructor(message: string, exitCode: number, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
    this.cause = cause;
  }
}

export class ConfigurationError extends CliError {
  public constructor(message: string, cause?: unknown) {
    super(message, 2, cause);
  }
}

export class FileStoreError extends CliError {
  public constructor(message: string, cause?: unknown) {
    super(message, 2, cause);
  }
}

export class AwsCliError extends CliError {
  public constructor(message: string, cause?: unknown) {
    super(message, 2, cause);
  }
}
