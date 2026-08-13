import { Type, type Static } from '@sinclair/typebox';

const groupSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String(),
  memberIds: Type.Array(Type.Integer({ minimum: 1 })),
});

export const groupNameBodySchema = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 30 }) },
  { additionalProperties: false },
);
export const groupMembersBodySchema = Type.Object(
  {
    userIds: Type.Array(Type.Integer({ minimum: 1 }), {
      maxItems: 500,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export const groupParamsSchema = Type.Object(
  { id: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export const legacyGroupListResponseSchema = Type.Array(groupSchema);
export const legacyGroupResponseSchema = groupSchema;
export const v1GroupListResponseSchema = Type.Object({ data: Type.Array(groupSchema) });
export const v1GroupResponseSchema = Type.Object({ data: groupSchema });
export const noContentResponseSchema = Type.Null();

export type GroupNameBody = Static<typeof groupNameBodySchema>;
export type GroupMembersBody = Static<typeof groupMembersBodySchema>;
export type GroupParams = Static<typeof groupParamsSchema>;
