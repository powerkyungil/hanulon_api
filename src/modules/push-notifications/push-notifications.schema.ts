import { Type, type Static } from '@sinclair/typebox';

const fcmTokenSchema = Type.String({ minLength: 20, maxLength: 4096 });

export const registerPushTokenBodySchema = Type.Object(
  {
    token: fcmTokenSchema,
    platform: Type.Literal('ANDROID'),
    deviceId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

export const deletePushTokenBodySchema = Type.Object(
  { token: fcmTokenSchema },
  { additionalProperties: false },
);

export const pushTokenResponseSchema = Type.Object({
  data: Type.Object({
    id: Type.Integer({ minimum: 1 }),
    platform: Type.Literal('ANDROID'),
    deviceId: Type.Union([Type.String(), Type.Null()]),
    updatedAt: Type.Integer({ minimum: 0 }),
  }),
});

export const noContentResponseSchema = Type.Null();

export type RegisterPushTokenBody = Static<typeof registerPushTokenBodySchema>;
export type DeletePushTokenBody = Static<typeof deletePushTokenBodySchema>;
