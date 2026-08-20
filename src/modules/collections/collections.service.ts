import { AppError } from '../../shared/errors/app-error';
import { CollectionsRepository } from './collections.repository';
import type {
  CollectionActor,
  CollectionCompletion,
  CollectionCompletionLogPage,
  CollectionInput,
  CollectionMutationStatus,
  ItemCollection,
} from './collections.types';

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed');

const normalizeInput = (input: CollectionInput): CollectionInput => ({
  name: input.name.trim(),
  items: input.items.map((item) => ({
    ...(item.id === undefined ? {} : { id: item.id }),
    part: item.part.trim(),
    enchantment: item.enchantment.trim(),
  })),
});

export class CollectionsService {
  public constructor(private readonly repository: CollectionsRepository) {}

  public getCollections(userId: number, guildId: number): ItemCollection[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findCollections(guildId);
  }

  public createCollection(userId: number, guildId: number, input: CollectionInput): ItemCollection {
    const actor = this.requireManager(userId, guildId);
    const normalized = normalizeInput(input);
    this.validateInput(normalized);
    if (normalized.items.some((item) => item.id !== undefined)) {
      throw new AppError(
        'COLLECTION_ITEM_ID_NOT_ALLOWED',
        '새 컬렉션의 아이템에는 ID를 지정할 수 없습니다.',
        422,
      );
    }
    this.requireUniqueName(guildId, normalized.name);
    try {
      const collectionId = this.repository.createCollection(actor, normalized);
      return this.requireCollection(guildId, collectionId);
    } catch (error) {
      this.rethrowUniqueName(error);
    }
  }

  public updateCollection(
    userId: number,
    guildId: number,
    collectionId: number,
    input: CollectionInput,
  ): ItemCollection {
    const actor = this.requireManager(userId, guildId);
    const current = this.requireCollection(guildId, collectionId);
    const normalized = normalizeInput(input);
    this.validateInput(normalized);
    this.requireUniqueName(guildId, normalized.name, collectionId);

    const suppliedIds = normalized.items.flatMap((item) =>
      item.id === undefined ? [] : [item.id],
    );
    if (new Set(suppliedIds).size !== suppliedIds.length) {
      throw new AppError(
        'COLLECTION_ITEM_ID_DUPLICATED',
        '아이템 ID를 중복해서 전달할 수 없습니다.',
        422,
      );
    }
    const currentIds = new Set(current.items.map((item) => item.id));
    if (suppliedIds.some((itemId) => !currentIds.has(itemId))) {
      throw new AppError(
        'COLLECTION_ITEM_INVALID',
        '해당 컬렉션에 속하지 않은 아이템 ID가 포함되어 있습니다.',
        422,
      );
    }

    try {
      this.repository.updateCollection(actor, current, normalized);
      return this.requireCollection(guildId, collectionId);
    } catch (error) {
      this.rethrowUniqueName(error);
    }
  }

  public deleteCollection(userId: number, guildId: number, collectionId: number): void {
    const actor = this.requireManager(userId, guildId);
    const collection = this.requireCollection(guildId, collectionId);
    this.repository.deleteCollection(actor, collection);
  }

  public getCompletions(userId: number, guildId: number): CollectionCompletion[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findCompletions(guildId);
  }

  public getCompletionLogs(
    userId: number,
    guildId: number,
    cursor: number | undefined,
    limit: number,
    targetUserId?: number,
  ): CollectionCompletionLogPage {
    this.requireCompletionLogViewer(userId, guildId);
    return this.repository.findCompletionLogs(guildId, cursor, limit, targetUserId);
  }

  public setCompletion(
    userId: number,
    guildId: number,
    targetUserId: number,
    itemId: number,
    completed: boolean,
  ): CollectionMutationStatus {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.id !== targetUserId && actor.role !== 'MASTER') {
      throw new AppError(
        'COLLECTION_COMPLETION_EDIT_FORBIDDEN',
        '본인 또는 길드장만 아이템 보유 상태를 변경할 수 있습니다.',
        403,
      );
    }
    if (!this.repository.activeUserExists(guildId, targetUserId)) {
      throw new AppError('MEMBER_NOT_FOUND', '길드원을 찾을 수 없습니다.', 404);
    }
    if (!this.repository.collectionItemExists(guildId, itemId)) {
      throw new AppError('COLLECTION_ITEM_NOT_FOUND', '컬렉션 아이템을 찾을 수 없습니다.', 404);
    }
    return this.repository.setCompletion(actor, targetUserId, itemId, completed);
  }

  public getExcludedMemberIds(userId: number, guildId: number): number[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findExcludedMemberIds(guildId);
  }

  public toggleExcluded(
    userId: number,
    guildId: number,
    targetUserId: number,
  ): CollectionMutationStatus {
    const actor = this.requireManager(userId, guildId);
    if (!this.repository.activeUserExists(guildId, targetUserId)) {
      throw new AppError('MEMBER_NOT_FOUND', '길드원을 찾을 수 없습니다.', 404);
    }
    return this.repository.toggleExcluded(actor, targetUserId);
  }

  private validateInput(input: CollectionInput): void {
    if (!input.name) {
      throw new AppError('VALIDATION_ERROR', '컬렉션 이름을 입력해 주세요.', 422, {
        field: 'name',
      });
    }
    if (input.items.length === 0) {
      throw new AppError('VALIDATION_ERROR', '아이템을 하나 이상 입력해 주세요.', 422, {
        field: 'items',
      });
    }
    if (input.items.some((item) => !item.part || !item.enchantment)) {
      throw new AppError(
        'VALIDATION_ERROR',
        '모든 아이템의 부위와 강화 상태를 입력해 주세요.',
        422,
        { field: 'items' },
      );
    }
  }

  private requireActiveActor(userId: number, guildId: number): CollectionActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    return actor;
  }

  private requireManager(userId: number, guildId: number): CollectionActor {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.role !== 'MASTER' && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', '컬렉션 관리 권한이 없습니다.', 403);
    }
    return actor;
  }

  private requireCompletionLogViewer(userId: number, guildId: number): CollectionActor {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.role !== 'MASTER' && actor.username !== '움매') {
      throw new AppError('FORBIDDEN', '컬렉션 체크 변경 로그 조회 권한이 없습니다.', 403);
    }
    return actor;
  }

  private requireCollection(guildId: number, collectionId: number): ItemCollection {
    const collection = this.repository.findCollection(guildId, collectionId);
    if (!collection) {
      throw new AppError('COLLECTION_NOT_FOUND', '컬렉션을 찾을 수 없습니다.', 404);
    }
    return collection;
  }

  private requireUniqueName(guildId: number, name: string, excludingCollectionId?: number): void {
    if (this.repository.collectionNameExists(guildId, name, excludingCollectionId)) {
      throw new AppError('COLLECTION_NAME_EXISTS', '이미 사용 중인 컬렉션 이름입니다.', 409);
    }
  }

  private rethrowUniqueName(error: unknown): never {
    if (isUniqueConstraintError(error)) {
      throw new AppError('COLLECTION_NAME_EXISTS', '이미 사용 중인 컬렉션 이름입니다.', 409);
    }
    throw error;
  }
}
