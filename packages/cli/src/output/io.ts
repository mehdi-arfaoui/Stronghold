import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeOutput(contents: string, outputPath?: string): Promise<void> {
  if (!outputPath) {
    process.stdout.write(`${contents}\n`);
    return;
  }

  const resolved = path.resolve(outputPath);
  await writeFile(resolved, `${contents}\n`, 'utf8');
}

export function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
}
