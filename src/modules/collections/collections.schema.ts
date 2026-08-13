import { Type, type Static } from '@sinclair/typebox';

const collectionItemInputSchema = Type.Object(
  {
    id: Type.Optional(Type.Integer({ minimum: 1 })),
    part: Type.String({ minLength: 1, maxLength: 100 }),
    enchantment: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);

const legacyCollectionItemSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  part: Type.String(),
  enchantment: Type.String(),
});

const v1CollectionItemSchema = Type.Object({
  ...legacyCollectionItemSchema.properties,
  sortOrder: Type.Integer({ minimum: 0 }),
});

const legacyCollectionSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String(),
  items: Type.Array(legacyCollectionItemSchema),
});

const v1CollectionSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String(),
  items: Type.Array(v1CollectionItemSchema),
});

const mutationStatusSchema = Type.Union([Type.Literal('added'), Type.Literal('removed')]);

export const collectionBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    items: Type.Array(collectionItemInputSchema, { minItems: 1, maxItems: 200 }),
  },
  { additionalProperties: false },
);
export const collectionParamsSchema = Type.Object(
  { id: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export const completionBodySchema = Type.Object(
  {
    userId: Type.Integer({ minimum: 1 }),
    collectionItemId: Type.Integer({ minimum: 1 }),
    completed: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const exclusionBodySchema = Type.Object(
  { userId: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export const legacyCollectionListResponseSchema = Type.Array(legacyCollectionSchema);
export const v1CollectionListResponseSchema = Type.Object({ data: Type.Array(v1CollectionSchema) });
export const v1CollectionResponseSchema = Type.Object({ data: v1CollectionSchema });
export const legacyCreatedResponseSchema = Type.Object({
  success: Type.Literal(true),
  id: Type.Integer({ minimum: 1 }),
});
export const legacySuccessResponseSchema = Type.Object({ success: Type.Literal(true) });
export const noContentResponseSchema = Type.Null();

const v1CompletionSchema = Type.Object({
  userId: Type.Integer({ minimum: 1 }),
  collectionItemId: Type.Integer({ minimum: 1 }),
});
const legacyCompletionSchema = Type.Object({
  user_id: Type.Integer({ minimum: 1 }),
  collection_item_id: Type.Integer({ minimum: 1 }),
});
export const v1CompletionListResponseSchema = Type.Object({
  data: Type.Array(v1CompletionSchema),
});
export const legacyCompletionListResponseSchema = Type.Array(legacyCompletionSchema);
export const v1CompletionMutationResponseSchema = Type.Object({
  data: Type.Object({ status: mutationStatusSchema, completed: Type.Boolean() }),
});
export const legacyMutationStatusResponseSchema = Type.Object({ status: mutationStatusSchema });

export const v1ExclusionListResponseSchema = Type.Object({
  data: Type.Array(Type.Integer({ minimum: 1 })),
});
export const legacyExclusionListResponseSchema = Type.Array(Type.Integer({ minimum: 1 }));
export const v1ExclusionMutationResponseSchema = Type.Object({
  data: Type.Object({ status: mutationStatusSchema }),
});

export type CollectionBody = Static<typeof collectionBodySchema>;
export type CollectionParams = Static<typeof collectionParamsSchema>;
export type CompletionBody = Static<typeof completionBodySchema>;
export type ExclusionBody = Static<typeof exclusionBodySchema>;
