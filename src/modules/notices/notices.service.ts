import { AppError } from '../../shared/errors/app-error';
import { bossControlCatalog, isCatalogBoss } from './notices.constants';
import { NoticesRepository } from './notices.repository';
import type {
  BossControlChapter,
  BossControlUpdate,
  NoticeActor,
  NoticeArticle,
  NoticeArticleInput,
  NoticeArticleType,
} from './notices.types';

const normalizeArticleInput = (input: NoticeArticleInput): NoticeArticleInput => ({
  title: input.title.trim(),
  content: input.content.trim(),
  color: input.color.trim().toUpperCase(),
});

export class NoticesService {
  public constructor(private readonly repository: NoticesRepository) {}

  public getArticles(userId: number, guildId: number, type: NoticeArticleType): NoticeArticle[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findArticles(guildId, type);
  }

  public createArticle(
    userId: number,
    guildId: number,
    type: NoticeArticleType,
    input: NoticeArticleInput,
  ): NoticeArticle {
    const actor = this.requireManager(userId, guildId);
    const normalized = normalizeArticleInput(input);
    this.validateArticle(normalized);
    const articleId = this.repository.createArticle(actor, type, normalized);
    return this.requireArticle(guildId, type, articleId);
  }

  public updateArticle(
    userId: number,
    guildId: number,
    type: NoticeArticleType,
    articleId: number,
    input: NoticeArticleInput,
  ): NoticeArticle {
    const actor = this.requireManager(userId, guildId);
    this.requireArticle(guildId, type, articleId);
    const normalized = normalizeArticleInput(input);
    this.validateArticle(normalized);
    this.repository.updateArticle(actor, type, articleId, normalized);
    return this.requireArticle(guildId, type, articleId);
  }

  public deleteArticle(
    userId: number,
    guildId: number,
    type: NoticeArticleType,
    articleId: number,
  ): void {
    const actor = this.requireManager(userId, guildId);
    this.requireArticle(guildId, type, articleId);
    this.repository.deleteArticle(actor, type, articleId);
  }

  public reorderRules(userId: number, guildId: number, ids: number[]): void {
    const actor = this.requireManager(userId, guildId);
    const currentIds = this.repository.findRuleIds(guildId);
    const requested = [...ids].sort((a, b) => a - b);
    const current = [...currentIds].sort((a, b) => a - b);
    if (
      requested.length !== current.length ||
      requested.some((id, index) => id !== current[index])
    ) {
      throw new AppError(
        'NOTICE_RULE_ORDER_INVALID',
        '현재 길드룰 전체 ID를 중복 없이 전달해 주세요.',
        422,
      );
    }
    if (ids.every((id, index) => id === currentIds[index])) return;
    this.repository.reorderRules(actor, ids);
  }

  public getBossControls(userId: number, guildId: number): BossControlChapter[] {
    this.requireActiveActor(userId, guildId);
    const states = new Map(
      this.repository
        .findBossControls(guildId)
        .map((row) => [`${row.chapter}::${row.boss}`, row.status] as const),
    );
    return bossControlCatalog.map((catalogChapter) => ({
      chapter: catalogChapter.chapter,
      bosses: catalogChapter.bosses.map((boss) => ({
        name: boss,
        status: states.get(`${catalogChapter.chapter}::${boss}`) ?? 'NONE',
      })),
    }));
  }

  public updateBossControl(
    userId: number,
    guildId: number,
    input: BossControlUpdate,
  ): BossControlUpdate {
    const actor = this.requireManager(userId, guildId);
    const normalized: BossControlUpdate = {
      chapter: input.chapter.trim(),
      boss: input.boss.trim(),
      status: input.status,
    };
    if (!isCatalogBoss(normalized.chapter, normalized.boss)) {
      throw new AppError('BOSS_CONTROL_TARGET_INVALID', '보스 통제 대상이 올바르지 않습니다.', 422);
    }
    this.repository.updateBossControl(actor, normalized);
    return normalized;
  }

  private validateArticle(input: NoticeArticleInput): void {
    if (!input.title) {
      throw new AppError('VALIDATION_ERROR', '공지 제목을 입력해 주세요.', 422, {
        field: 'title',
      });
    }
    if (!input.content) {
      throw new AppError('VALIDATION_ERROR', '공지 내용을 입력해 주세요.', 422, {
        field: 'content',
      });
    }
  }

  private requireArticle(
    guildId: number,
    type: NoticeArticleType,
    articleId: number,
  ): NoticeArticle {
    const article = this.repository.findArticle(guildId, type, articleId);
    if (!article) {
      throw new AppError('NOTICE_NOT_FOUND', '공지를 찾을 수 없습니다.', 404);
    }
    return article;
  }

  private requireActiveActor(userId: number, guildId: number): NoticeActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    return actor;
  }

  private requireManager(userId: number, guildId: number): NoticeActor {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.role !== 'MASTER' && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', '공지 관리 권한이 없습니다.', 403);
    }
    return actor;
  }
}
