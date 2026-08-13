import { Type, type Static } from '@sinclair/typebox';

const colorSchema = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });
const bossControlStatusSchema = Type.Union([
  Type.Literal('NONE'),
  Type.Literal('ALLY_ONLY'),
  Type.Literal('CONTROL'),
]);

const articleInputProperties = {
  title: Type.String({ minLength: 1, maxLength: 100 }),
  content: Type.String({ minLength: 1, maxLength: 20000 }),
  color: colorSchema,
};

const v1ArticleSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  title: Type.String(),
  content: Type.String(),
  color: colorSchema,
  sortOrder: Type.Integer({ minimum: 0 }),
  updatedAt: Type.Integer({ minimum: 0 }),
});

const legacyArticleSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  title: Type.String(),
  content: Type.String(),
  color: colorSchema,
  sort_order: Type.Integer({ minimum: 0 }),
  updated_at: Type.String(),
});

const bossControlSchema = Type.Object({
  name: Type.String(),
  status: bossControlStatusSchema,
});

const bossControlChapterSchema = Type.Object({
  chapter: Type.String(),
  bosses: Type.Array(bossControlSchema),
});

const bossControlCollectionSchema = Type.Object({
  chapters: Type.Array(bossControlChapterSchema),
});

export const noticeArticleBodySchema = Type.Object(articleInputProperties, {
  additionalProperties: false,
});
export const noticeArticleParamsSchema = Type.Object(
  { id: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export const noticeRuleOrderBodySchema = Type.Object(
  {
    ids: Type.Array(Type.Integer({ minimum: 1 }), {
      minItems: 1,
      maxItems: 500,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export const bossControlUpdateBodySchema = Type.Object(
  {
    chapter: Type.String({ minLength: 1, maxLength: 50 }),
    boss: Type.String({ minLength: 1, maxLength: 50 }),
    status: bossControlStatusSchema,
  },
  { additionalProperties: false },
);

export const v1NoticeArticleListResponseSchema = Type.Object({
  data: Type.Array(v1ArticleSchema),
});
export const legacyNoticeArticleListResponseSchema = Type.Array(legacyArticleSchema);
export const v1NoticeArticleResponseSchema = Type.Object({ data: v1ArticleSchema });
export const legacyCreatedResponseSchema = Type.Object({
  success: Type.Literal(true),
  id: Type.Integer({ minimum: 1 }),
});
export const legacySuccessResponseSchema = Type.Object({ success: Type.Literal(true) });
export const noContentResponseSchema = Type.Null();

export const v1BossControlsResponseSchema = Type.Object({ data: bossControlCollectionSchema });
export const legacyBossControlsResponseSchema = bossControlCollectionSchema;
export const v1BossControlUpdateResponseSchema = Type.Object({
  data: Type.Object({
    chapter: Type.String(),
    boss: Type.String(),
    status: bossControlStatusSchema,
  }),
});

export type NoticeArticleBody = Static<typeof noticeArticleBodySchema>;
export type NoticeArticleParams = Static<typeof noticeArticleParamsSchema>;
export type NoticeRuleOrderBody = Static<typeof noticeRuleOrderBodySchema>;
export type BossControlUpdateBody = Static<typeof bossControlUpdateBodySchema>;
