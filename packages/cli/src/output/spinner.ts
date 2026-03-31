import ora, { type Ora } from 'ora';

export interface SpinnerController {
  start(text: string): void;
  succeed(text: string): void;
  fail(text: string): void;
  stop(): void;
  readonly active: boolean;
}

class OraSpinnerController implements SpinnerController {
  private readonly spinner: Ora;

  public constructor(enabled: boolean) {
    this.spinner = ora({ isEnabled: enabled });
  }

  public get active(): boolean {
    return this.spinner.isSpinning;
  }

  public start(text: string): void {
    this.spinner.start(text);
  }

  public succeed(text: string): void {
    if (this.spinner.isSpinning) {
      this.spinner.succeed(text);
      return;
    }
    this.spinner.info(text);
  }

  public fail(text: string): void {
    if (this.spinner.isSpinning) {
      this.spinner.fail(text);
      return;
    }
    this.spinner.warn(text);
  }

  public stop(): void {
    this.spinner.stop();
  }
}

export function createSpinner(enabled = process.stdout.isTTY): SpinnerController {
  return new OraSpinnerController(enabled);
}
