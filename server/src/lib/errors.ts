/** Errors carrying a safe, user-facing message and an HTTP status. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do this.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
/** A business rule was violated (e.g. not enough stock). */
export const unprocessable = (message: string, details?: unknown) => new AppError(422, 'BUSINESS_RULE', message, details);
