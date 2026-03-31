const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class APIError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await response.json().catch(() => ({}));
      const errorBody =
        body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const nestedError =
        errorBody.error && typeof errorBody.error === 'object'
          ? (errorBody.error as Record<string, unknown>)
          : {};
      throw new APIError(
        response.status,
        typeof nestedError.code === 'string' ? nestedError.code : 'UNKNOWN',
        typeof nestedError.message === 'string' ? nestedError.message : response.statusText,
      );
    }

    throw new APIError(
      response.status,
      'SERVER_ERROR',
      `Server returned ${response.status}: ${response.statusText}`,
    );
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (
    contentType.includes('text/markdown') ||
    contentType.includes('text/yaml') ||
    contentType.includes('application/yaml') ||
    contentType.includes('text/plain')
  ) {
    return (await response.text()) as T;
  }
  if (!contentType.includes('application/json')) {
    throw new APIError(0, 'UNEXPECTED_CONTENT', `Expected JSON, got ${contentType}`);
  }

  return response.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  return handleResponse<T>(response);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 204) {
    await handleResponse<void>(response);
  }
}
