import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { CliError } from './errors/cli-error.js';
import { writeError } from './output/io.js';
import { registerDemoCommand } from './commands/demo.js';
import { registerDriftCommand } from './commands/drift.js';
import { registerIamPolicyCommand } from './commands/iam-policy.js';
import { registerInitCommand } from './commands/init.js';
import { registerPlanCommand } from './commands/plan.js';
import { registerReportCommand } from './commands/report.js';
import { registerScanCommand } from './commands/scan.js';
import { registerOverridesCommand } from './commands/overrides.js';
import { registerServicesCommand } from './commands/services.js';
import { registerStatusCommand } from './commands/status.js';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('stronghold')
    .description('Open-source disaster recovery automation for cloud infrastructure')
    .version('0.1.0')
    .option('--encrypt', 'Encrypt sensitive files written by Stronghold', false)
    .option('--passphrase <string>', 'Passphrase used to encrypt or decrypt files')
    .option('--redact', 'Redact sensitive identifiers from generated output', false)
    .option('--no-redact', 'Disable output redaction');

  registerInitCommand(program);
  registerScanCommand(program);
  registerReportCommand(program);
  registerPlanCommand(program);
  registerDriftCommand(program);
  registerOverridesCommand(program);
  registerDemoCommand(program);
  registerIamPolicyCommand(program);
  registerServicesCommand(program);
  registerStatusCommand(program);

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CliError) {
      writeError(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    if (error instanceof Error) {
      writeError(error.message);
      process.exitCode = 1;
      return;
    }
    writeError(String(error));
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryFile && currentFile === entryFile) {
  void runCli();
}
