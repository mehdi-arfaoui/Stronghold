import fs from 'node:fs';
import path from 'node:path';

import {
  decrypt,
  encrypt,
  isEncryptedPayload,
  type EncryptedPayload,
} from '@stronghold-dr/core';

import { FileStoreError } from '../errors/cli-error.js';
import { resolvePassphrase } from '../security/passphrase.js';
import {
  type ScanResults,
  parseScanResults,
  serializeScanResults,
} from './file-store.js';

export const ENCRYPTED_FILE_EXTENSION = '.stronghold-enc';
const GITIGNORE_FILENAME = '.gitignore';
const GITIGNORE_CONTENT = `# Stronghold scan results contain infrastructure metadata (ARNs, IPs, configurations).
# These files do NOT contain AWS credentials or secrets.
# Review content before committing.
*
!.gitignore
`;

export interface EncryptionPreference {
  readonly encrypt: boolean;
  readonly passphrase?: string;
}

export async function loadScanResultsWithEncryption(
  filePath: string,
  options: Omit<EncryptionPreference, 'encrypt'> = {},
): Promise<ScanResults> {
  const resolvedPath = path.resolve(filePath);
  const contents = await readTextFile(resolvedPath, options, 'Enter passphrase to decrypt scan results');
  return parseScanResults(contents, resolvedPath);
}

export async function saveScanResultsWithEncryption(
  results: ScanResults,
  filePath: string,
  options: EncryptionPreference,
): Promise<string> {
  const contents = serializeScanResults(results);
  return writeTextFile(contents, filePath, options, 'Enter passphrase to encrypt scan results');
}

export async function readTextFile(
  filePath: string,
  options: Omit<EncryptionPreference, 'encrypt'> = {},
  prompt = 'Enter passphrase to decrypt file',
): Promise<string> {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new FileStoreError(`No file found at ${resolvedPath}.`);
  }

  try {
    const contents = fs.readFileSync(resolvedPath, 'utf8');
    const payload = parseEncryptedPayload(contents);
    if (!payload) {
      return contents;
    }

    const passphrase = await resolvePassphrase(options.passphrase, prompt);
    return decrypt(payload, passphrase);
  } catch (error) {
    if (error instanceof FileStoreError) {
      throw error;
    }
    throw new FileStoreError(`Unable to read file from ${resolvedPath}.`, error);
  }
}

export async function writeTextFile(
  contents: string,
  filePath: string,
  options: EncryptionPreference,
  prompt = 'Enter passphrase to encrypt file',
): Promise<string> {
  const targetPath = path.resolve(options.encrypt ? toEncryptedFilePath(filePath) : filePath);
  ensureDirectory(path.dirname(targetPath));
  if (path.basename(path.dirname(targetPath)) === '.stronghold') {
    ensureGitignore(path.dirname(targetPath));
  }

  try {
    const serialized = options.encrypt
      ? JSON.stringify(
          encrypt(contents, await resolvePassphrase(options.passphrase, prompt)),
          null,
          2,
        )
      : contents;
    fs.writeFileSync(targetPath, `${serialized}\n`, 'utf8');
    return targetPath;
  } catch (error) {
    throw new FileStoreError(`Unable to write file to ${targetPath}.`, error);
  }
}

export function toEncryptedFilePath(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${ENCRYPTED_FILE_EXTENSION}`);
}

export function parseEncryptedPayload(contents: string): EncryptedPayload | null {
  try {
    const parsed = JSON.parse(contents) as unknown;
    return isEncryptedPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function ensureGitignore(directoryPath: string): void {
  const gitignorePath = path.join(directoryPath, GITIGNORE_FILENAME);
  if (fs.existsSync(gitignorePath)) {
    return;
  }

  fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf8');
}
