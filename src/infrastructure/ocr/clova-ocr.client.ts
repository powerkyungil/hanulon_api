export type OcrImageContentType = 'image/jpeg' | 'image/png';

export class OcrUpstreamError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'OcrUpstreamError';
  }
}

export class ClovaOcrClient {
  public constructor(
    private readonly invokeUrl: string,
    private readonly secret: string,
  ) {}

  public async analyze(
    image: Buffer,
    contentType: OcrImageContentType,
    templateId: number,
  ): Promise<unknown> {
    const imageFormat = contentType === 'image/png' ? 'png' : 'jpg';
    const form = new FormData();
    form.append(
      'message',
      JSON.stringify({
        version: 'V2',
        requestId: crypto.randomUUID(),
        timestamp: Date.now(),
        lang: 'ko',
        images: [
          {
            format: imageFormat,
            name: 'boss-schedule',
            templateIds: [templateId],
          },
        ],
      }),
    );
    form.append(
      'file',
      new Blob([new Uint8Array(image)], { type: contentType }),
      `boss-schedule.${imageFormat}`,
    );

    let response: Response;
    try {
      response = await fetch(this.invokeUrl, {
        method: 'POST',
        headers: { 'X-OCR-SECRET': this.secret },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      const message =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'OCR 분석 시간이 초과되었습니다.'
          : 'OCR 서버 연결에 실패했습니다.';
      throw new OcrUpstreamError(message, 502);
    }

    const responseText = await response.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(responseText) as unknown;
    } catch {
      throw new OcrUpstreamError('CLOVA OCR 응답을 해석할 수 없습니다.', 502);
    }
    if (!response.ok) {
      const upstreamMessage =
        typeof responseBody === 'object' &&
        responseBody !== null &&
        'message' in responseBody &&
        typeof responseBody.message === 'string'
          ? responseBody.message
          : 'CLOVA OCR 분석에 실패했습니다.';
      throw new OcrUpstreamError(
        upstreamMessage,
        response.status >= 400 && response.status < 500 ? response.status : 502,
      );
    }
    return responseBody;
  }
}
