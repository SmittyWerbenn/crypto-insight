export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export class UpstreamUnavailableError extends AppError {
  constructor(service: string, message: string, public lastSuccess?: string | null) {
    super(503, `${service.toUpperCase()}_UNAVAILABLE`, message, { lastSuccess });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
  }
}

export class ValidationFailedError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}
