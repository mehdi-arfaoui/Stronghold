import fs from 'node:fs';
import path from 'node:path';

import { applyEvidenceFreshness, checkFreshness } from './evidence-freshness.js';
import type { Evidence } from './evidence-types.js';

const GITIGNORE_CONTENT = `# Stronghold local state contains infrastructure metadata and evidence history.
*
!.gitignore
`;

export interface EvidenceStore {
  add(evidence: Evidence): Promise<void>;
  getByNode(nodeId: string): Promise<readonly Evidence[]>;
  getByService(serviceId: string): Promise<readonly Evidence[]>;
  getExpired(asOf?: string): Promise<readonly Evidence[]>;
  getAll(): Promise<readonly Evidence[]>;
}

export class FileEvidenceStore implements EvidenceStore {
  public constructor(private readonly filePath: string) {}

  public async add(evidence: Evidence): Promise<void> {
    const targetPath = path.resolve(this.filePath);
    ensureDirectory(path.dirname(targetPath));
    if (path.basename(path.dirname(targetPath)) === '.stronghold') {
      ensureGitignore(path.dirname(targetPath));
    }

    await fs.promises.appendFile(targetPath, `${JSON.stringify(evidence)}\n`, 'utf8');
  }

  public async getByNode(nodeId: string): Promise<readonly Evidence[]> {
    return (await this.getAll()).filter((evidence) => evidence.subject.nodeId === nodeId);
  }

  public async getByService(serviceId: string): Promise<readonly Evidence[]> {
    return (await this.getAll()).filter((evidence) => evidence.subject.serviceId === serviceId);
  }

  public async getExpired(asOf?: string): Promise<readonly Evidence[]> {
    const at = asOf ? new Date(asOf) : new Date();
    return (await this.readEntries(at)).filter(
      (evidence) => checkFreshness(evidence, at).status === 'expired',
    );
  }

  public async getAll(): Promise<readonly Evidence[]> {
    return this.readEntries(new Date());
  }

  private async readEntries(asOf: Date): Promise<readonly Evidence[]> {
    const targetPath = path.resolve(this.filePath);
    if (!fs.existsSync(targetPath)) {
      return [];
    }

    const contents = await fs.promises.readFile(targetPath, 'utf8');
    return contents
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => applyEvidenceFreshness(JSON.parse(line) as Evidence, asOf));
  }
}

function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function ensureGitignore(directoryPath: string): void {
  const gitignorePath = path.join(directoryPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    return;
  }

  fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf8');
}
