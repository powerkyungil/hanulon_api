import { Type } from '@sinclair/typebox';

export const healthResponseSchema = Type.Object({
  data: Type.Object({
    status: Type.Literal('ok'),
  }),
});

export const readinessResponseSchema = Type.Object({
  data: Type.Object({
    status: Type.Literal('ready'),
    database: Type.Literal('ok'),
    migrationsApplied: Type.Integer({ minimum: 0 }),
  }),
});

export const readinessUnavailableResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.Literal('DATABASE_NOT_READY'),
    message: Type.String(),
    details: Type.Null(),
    requestId: Type.String(),
  }),
});
