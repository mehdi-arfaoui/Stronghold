import type { AwsCredentials } from './auth-provider.js';

interface CachedEntry {
  readonly credentials: AwsCredentials;
  readonly fetchedAt: Date;
}

export class CredentialCache {
  private readonly cache = new Map<string, CachedEntry>();
  private readonly pending = new Map<string, Promise<AwsCredentials>>();
  private readonly refreshBufferMs: number;
  private hits = 0;
  private misses = 0;
  private refreshes = 0;

  public constructor(options: { refreshBufferMs?: number } = {}) {
    this.refreshBufferMs = options.refreshBufferMs ?? 5 * 60 * 1000;
  }

  public async get(
    key: string,
    fetcher: () => Promise<AwsCredentials>,
  ): Promise<AwsCredentials> {
    const existing = this.cache.get(key);
    if (existing && !shouldRefresh(existing.credentials, this.refreshBufferMs)) {
      this.hits += 1;
      return existing.credentials;
    }

    const pending = this.pending.get(key);
    if (pending) {
      return pending;
    }

    if (existing) {
      this.refreshes += 1;
    } else {
      this.misses += 1;
    }

    const next = fetcher()
      .then((credentials) => {
        this.cache.set(key, {
          credentials,
          fetchedAt: new Date(),
        });
        return credentials;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, next);
    return next;
  }

  public invalidate(key: string): void {
    this.cache.delete(key);
    this.pending.delete(key);
  }

  public stats(): { hits: number; misses: number; refreshes: number; size: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      refreshes: this.refreshes,
      size: this.cache.size,
    };
  }
}

function shouldRefresh(credentials: AwsCredentials, refreshBufferMs: number): boolean {
  if (!credentials.expiration) {
    return false;
  }

  return credentials.expiration.getTime() - Date.now() < refreshBufferMs;
}
