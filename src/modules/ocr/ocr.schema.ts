import { Type, type Static } from '@sinclair/typebox';

export const ocrHeadersSchema = Type.Object(
  {
    'x-ocr-template-id': Type.String({ pattern: '^[1-9][0-9]*$' }),
  },
  { additionalProperties: true },
);

export const ocrTemplateListSchema = Type.Object({
  templates: Type.Array(
    Type.Object({
      id: Type.Integer({ minimum: 1 }),
      name: Type.String({ minLength: 1 }),
    }),
  ),
});

export type OcrHeaders = Static<typeof ocrHeadersSchema>;
