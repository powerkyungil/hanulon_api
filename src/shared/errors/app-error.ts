export type AppErrorDetails = Record<string, unknown> | null;

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: AppErrorDetails;

  constructor(code: string, message: string, statusCode: number, details: AppErrorDetails = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
