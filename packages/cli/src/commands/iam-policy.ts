import { Command } from 'commander';

import type { IamPolicyCommandOptions } from '../config/options.js';
import { buildIamPolicy, renderIamPolicyJson, renderIamPolicyTerraform } from '../config/iam-policy.js';
import { parseServiceOption } from '../config/options.js';
import { writeOutput } from '../output/io.js';

export function registerIamPolicyCommand(program: Command): void {
  program
    .command('iam-policy')
    .description('Generate the minimal IAM policy required for Stronghold scans')
    .option('--format <format>', 'Output format: json|terraform', 'json')
    .option('--services <services>', 'Only include permissions for these services', parseServiceOption)
    .option('--verbose', 'Show detailed logs', false)
    .action(async (options: IamPolicyCommandOptions) => {
      const policy = buildIamPolicy(options.services);
      const contents =
        options.format === 'terraform'
          ? renderIamPolicyTerraform(policy)
          : renderIamPolicyJson(policy);
      await writeOutput(contents);
    });
}
