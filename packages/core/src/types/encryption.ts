export interface EncryptedPayload {
  readonly version: 1;
  readonly algorithm: 'aes-256-gcm';
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}
