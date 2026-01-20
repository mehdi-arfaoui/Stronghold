declare module "cors" {
  import type { RequestHandler } from "express";

  export interface CorsOptions {
    origin?:
      | boolean
      | string
      | RegExp
      | Array<boolean | string | RegExp>
      | ((
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean) => void
        ) => void);
    credentials?: boolean;
    methods?: string[];
    allowedHeaders?: string[];
  }

  const cors: (options?: CorsOptions) => RequestHandler;
  export default cors;
}
