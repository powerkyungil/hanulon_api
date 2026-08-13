import { Type, type Static } from '@sinclair/typebox';

const requestStatusSchema = Type.Union([
  Type.Literal('OPEN'),
  Type.Literal('MATCHED'),
  Type.Literal('DONE'),
  Type.Literal('CANCELED'),
]);
const applicationStatusSchema = Type.Union([Type.Literal('APPLIED'), Type.Literal('SELECTED')]);

const v1ApplicationSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  requestId: Type.Integer({ minimum: 1 }),
  applicantId: Type.Integer({ minimum: 1 }),
  memo: Type.String(),
  status: applicationStatusSchema,
  createdAt: Type.Integer({ minimum: 0 }),
  nickname: Type.String(),
  occupation: Type.String(),
  mainClass: Type.String(),
  combatPower: Type.Integer({ minimum: 0 }),
});

const legacyApplicationSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  requestId: Type.Integer({ minimum: 1 }),
  applicantId: Type.Integer({ minimum: 1 }),
  memo: Type.String(),
  status: applicationStatusSchema,
  createdAt: Type.String(),
  nickname: Type.String(),
  occupation: Type.String(),
  mainClass: Type.String(),
  combatPower: Type.Integer({ minimum: 0 }),
});

const v1RequestSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  requesterId: Type.Integer({ minimum: 1 }),
  requestedTime: Type.String(),
  memo: Type.String(),
  status: requestStatusSchema,
  selectedApplicationId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  createdAt: Type.Integer({ minimum: 0 }),
  updatedAt: Type.Integer({ minimum: 0 }),
  nickname: Type.String(),
  occupation: Type.String(),
  mainClass: Type.String(),
  combatPower: Type.Integer({ minimum: 0 }),
  applications: Type.Array(v1ApplicationSchema),
});

const legacyRequestSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  requesterId: Type.Integer({ minimum: 1 }),
  requestedTime: Type.String(),
  memo: Type.String(),
  status: requestStatusSchema,
  selectedApplicationId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  nickname: Type.String(),
  occupation: Type.String(),
  mainClass: Type.String(),
  combatPower: Type.Integer({ minimum: 0 }),
  applications: Type.Array(legacyApplicationSchema),
});

export const supportRequestBodySchema = Type.Object(
  {
    requestedTime: Type.String({ minLength: 1, maxLength: 80 }),
    memo: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export const supportStatusBodySchema = Type.Object(
  { status: requestStatusSchema },
  { additionalProperties: false },
);
export const supportApplicationBodySchema = Type.Object(
  { memo: Type.Optional(Type.String({ maxLength: 500 })) },
  { additionalProperties: false },
);
export const supportRequestParamsSchema = Type.Object(
  { id: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export const supportApplicationParamsSchema = Type.Object(
  {
    requestId: Type.Integer({ minimum: 1 }),
    applicationId: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const v1SupportListResponseSchema = Type.Object({ data: Type.Array(v1RequestSchema) });
export const legacySupportListResponseSchema = Type.Array(legacyRequestSchema);
export const v1CreatedIdResponseSchema = Type.Object({
  data: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
});
export const legacyCreatedIdResponseSchema = Type.Object({
  success: Type.Literal(true),
  id: Type.Integer({ minimum: 1 }),
});
export const legacySuccessResponseSchema = Type.Object({ success: Type.Literal(true) });
export const noContentResponseSchema = Type.Null();

export type SupportRequestBody = Static<typeof supportRequestBodySchema>;
export type SupportStatusBody = Static<typeof supportStatusBodySchema>;
export type SupportApplicationBody = Static<typeof supportApplicationBodySchema>;
export type SupportRequestParams = Static<typeof supportRequestParamsSchema>;
export type SupportApplicationParams = Static<typeof supportApplicationParamsSchema>;
