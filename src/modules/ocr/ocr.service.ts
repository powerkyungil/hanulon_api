import type { OcrTemplateConfig } from '../../config/env';
import {
  ClovaOcrClient,
  OcrUpstreamError,
  type OcrImageContentType,
} from '../../infrastructure/ocr/clova-ocr.client';
import { AppError } from '../../shared/errors/app-error';
import { OcrRepository } from './ocr.repository';

export class OcrService {
  private processing = false;

  public constructor(
    private readonly repository: OcrRepository,
    private readonly client: ClovaOcrClient,
    private readonly configured: boolean,
    private readonly templates: OcrTemplateConfig[],
  ) {}

  public getTemplates(userId: number, guildId: number): OcrTemplateConfig[] {
    this.requireMaster(userId, guildId);
    return this.templates;
  }

  public async analyze(
    userId: number,
    guildId: number,
    image: Buffer,
    contentType: OcrImageContentType,
    templateId: number,
  ): Promise<unknown> {
    this.requireMaster(userId, guildId);
    if (!this.configured || this.templates.length === 0) {
      throw new AppError(
        'OCR_NOT_CONFIGURED',
        'CLOVA Template OCR 환경변수가 설정되지 않았습니다.',
        503,
      );
    }
    if (image.length === 0) {
      throw new AppError('OCR_IMAGE_REQUIRED', 'OCR 이미지가 필요합니다.', 400);
    }
    if (!this.templates.some((template) => template.id === templateId)) {
      throw new AppError('OCR_TEMPLATE_NOT_FOUND', '선택한 OCR 템플릿을 찾을 수 없습니다.', 400);
    }
    if (this.processing) {
      throw new AppError(
        'OCR_BUSY',
        '다른 스크린샷을 분석 중입니다. 잠시 후 다시 시도해주세요.',
        429,
      );
    }

    this.processing = true;
    try {
      return await this.client.analyze(image, contentType, templateId);
    } catch (error) {
      if (error instanceof OcrUpstreamError) {
        throw new AppError('OCR_UPSTREAM_ERROR', error.message, error.statusCode);
      }
      throw error;
    } finally {
      this.processing = false;
    }
  }

  private requireMaster(userId: number, guildId: number): void {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    if (actor.role !== 'MASTER') {
      throw new AppError('FORBIDDEN', '스크린샷 분석 기능은 길드장만 사용할 수 있습니다.', 403);
    }
  }
}
