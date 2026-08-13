export const success = <T>(data: T) => ({ data });

export const failure = (
  code: string,
  message: string,
  requestId: string,
  details: Record<string, unknown> | null = null,
) => ({
  error: {
    code,
    message,
    details,
    requestId,
  },
});

export const legacyFailure = (
  code: string,
  message: string,
  requestId: string,
  details: Record<string, unknown> | null = null,
) => ({
  code,
  message,
  details,
  requestId,
});
