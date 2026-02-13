import type { NextFunction, Request, Response } from "express";

type ErrorResponseBody = {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string | Record<string, unknown>;
  error: {
    code: string;
    message: string | Record<string, unknown>;
  };
  stack?: string;
};

export class GlobalExceptionFilter {
  catch(exception: unknown, req: Request, res: Response, _next: NextFunction) {
    const status =
      typeof (exception as any)?.statusCode === "number"
        ? Number((exception as any).statusCode)
        : typeof (exception as any)?.status === "number"
          ? Number((exception as any).status)
          : 500;

    const exceptionMessage =
      typeof (exception as any)?.message === "string" && (exception as any).message.trim().length > 0
        ? (exception as any).message
        : "Internal server error";

    console.error(
      JSON.stringify({
        level: "error",
        scope: "http.globalExceptionFilter",
        method: req.method,
        path: req.originalUrl || req.url,
        status,
        message: exceptionMessage,
        stack: exception instanceof Error ? exception.stack : undefined,
      })
    );

    const body: ErrorResponseBody = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
      message:
        process.env.NODE_ENV === "production" && status >= 500
          ? "Internal server error"
          : exceptionMessage,
      error: {
        code: `ERR_${status}`,
        message:
          process.env.NODE_ENV === "production" && status >= 500
            ? "Internal server error"
            : exceptionMessage,
      },
    };

    if (process.env.NODE_ENV !== "production" && exception instanceof Error && exception.stack) {
      body.stack = exception.stack;
    }

    res.status(status).json(body);
  }
}
