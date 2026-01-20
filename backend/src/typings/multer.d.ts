declare module "multer" {
  import type { RequestHandler } from "express";

  export type MulterFile = {
    path: string;
    mimetype: string;
    originalname: string;
    filename: string;
    size: number;
  };

  export type DiskStorageOptions = {
    destination: (
      req: unknown,
      file: MulterFile,
      cb: (error: Error | null, destination: string) => void
    ) => void;
    filename: (
      req: unknown,
      file: MulterFile,
      cb: (error: Error | null, filename: string) => void
    ) => void;
  };

  export type MulterOptions = {
    storage?: unknown;
    fileFilter?: (
      req: unknown,
      file: MulterFile,
      cb: (error: Error | null, acceptFile?: boolean) => void
    ) => void;
    limits?: Record<string, unknown>;
  };

  export type MulterInstance = {
    single: (fieldName: string) => RequestHandler;
  };

  export class MulterError extends Error {
    code: string;
    field?: string;
  }

  type MulterFactory = {
    (options?: MulterOptions): MulterInstance;
    diskStorage: (options: DiskStorageOptions) => unknown;
    MulterError: typeof MulterError;
  };

  const multer: MulterFactory;
  export default multer;
}
