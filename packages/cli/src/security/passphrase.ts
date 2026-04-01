import { createInterface } from 'node:readline/promises';

import { ConfigurationError } from '../errors/cli-error.js';

export async function resolvePassphrase(
  passphrase: string | undefined,
  prompt: string,
): Promise<string> {
  if (passphrase && passphrase.length > 0) {
    return passphrase;
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const value = await readline.question(`${prompt}: `);
    if (value.length === 0) {
      throw new ConfigurationError('A passphrase is required when encryption is enabled.');
    }
    return value;
  } finally {
    readline.close();
  }
}
