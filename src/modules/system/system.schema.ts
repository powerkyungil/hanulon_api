import { Type } from '@sinclair/typebox';

export const timeResponseSchema = Type.Object({
  data: Type.Object({
    epochMs: Type.Integer(),
    timeZone: Type.Literal('Asia/Seoul'),
  }),
});
