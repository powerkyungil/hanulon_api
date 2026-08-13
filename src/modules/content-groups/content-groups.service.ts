import { AppError } from '../../shared/errors/app-error';
import { ContentGroupsRepository } from './content-groups.repository';
import type { ContentGroup, ContentGroupActor } from './content-groups.types';

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed');

export class ContentGroupsService {
  public constructor(private readonly repository: ContentGroupsRepository) {}

  public getGroups(userId: number, guildId: number): ContentGroup[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findGroups(guildId);
  }

  public createGroup(userId: number, guildId: number, name: string): ContentGroup {
    const actor = this.requireManager(userId, guildId);
    const normalizedName = this.normalizeName(name);
    this.requireUniqueName(guildId, normalizedName);
    try {
      const groupId = this.repository.createGroup(actor, normalizedName);
      return this.requireGroup(guildId, groupId);
    } catch (error) {
      this.rethrowUniqueName(error);
    }
  }

  public renameGroup(userId: number, guildId: number, groupId: number, name: string): void {
    const actor = this.requireManager(userId, guildId);
    const group = this.requireGroup(guildId, groupId);
    const normalizedName = this.normalizeName(name);
    if (group.name === normalizedName) return;
    this.requireUniqueName(guildId, normalizedName, group.id);
    try {
      this.repository.renameGroup(actor, group, normalizedName);
    } catch (error) {
      this.rethrowUniqueName(error);
    }
  }

  public deleteGroup(userId: number, guildId: number, groupId: number): void {
    const actor = this.requireManager(userId, guildId);
    const group = this.requireGroup(guildId, groupId);
    this.repository.deleteGroup(actor, group);
  }

  public replaceMembers(userId: number, guildId: number, groupId: number, userIds: number[]): void {
    const actor = this.requireManager(userId, guildId);
    const group = this.requireGroup(guildId, groupId);
    const invalidUserIds = this.repository.findInvalidActiveUserIds(guildId, userIds);
    if (invalidUserIds.length > 0) {
      throw new AppError(
        'CONTENT_GROUP_MEMBER_INVALID',
        '같은 길드의 활성 길드원만 배치할 수 있습니다.',
        422,
        { userIds: invalidUserIds },
      );
    }
    const assignedUserIds = this.repository.findMembersAssignedToOtherGroups(group.id, userIds);
    if (assignedUserIds.length > 0) {
      throw new AppError(
        'CONTENT_GROUP_MEMBER_ALREADY_ASSIGNED',
        '다른 그룹에 이미 배치된 길드원이 있습니다.',
        409,
        { userIds: assignedUserIds },
      );
    }
    if (
      group.memberIds.length === userIds.length &&
      group.memberIds.every((memberId, index) => memberId === userIds[index])
    ) {
      return;
    }

    try {
      this.repository.replaceMembers(actor, group, userIds);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONTENT_GROUP_MEMBER_INVALID:')) {
        throw new AppError(
          'CONTENT_GROUP_MEMBER_INVALID',
          '같은 길드의 활성 길드원만 배치할 수 있습니다.',
          422,
        );
      }
      if (
        error instanceof Error &&
        (error.message.startsWith('CONTENT_GROUP_MEMBER_ALREADY_ASSIGNED:') ||
          isUniqueConstraintError(error))
      ) {
        throw new AppError(
          'CONTENT_GROUP_MEMBER_ALREADY_ASSIGNED',
          '다른 그룹에 이미 배치된 길드원이 있습니다.',
          409,
        );
      }
      throw error;
    }
  }

  private normalizeName(name: string): string {
    const normalized = name.trim();
    if (!normalized) {
      throw new AppError('VALIDATION_ERROR', '그룹 이름을 입력해 주세요.', 422, {
        field: 'name',
      });
    }
    return normalized;
  }

  private requireActiveActor(userId: number, guildId: number): ContentGroupActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    return actor;
  }

  private requireManager(userId: number, guildId: number): ContentGroupActor {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.role !== 'MASTER' && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', '콘텐츠 그룹 관리 권한이 없습니다.', 403);
    }
    return actor;
  }

  private requireGroup(guildId: number, groupId: number): ContentGroup {
    const group = this.repository.findGroup(guildId, groupId);
    if (!group) {
      throw new AppError('CONTENT_GROUP_NOT_FOUND', '콘텐츠 그룹을 찾을 수 없습니다.', 404);
    }
    return group;
  }

  private requireUniqueName(guildId: number, name: string, excludingGroupId?: number): void {
    if (this.repository.groupNameExists(guildId, name, excludingGroupId)) {
      throw new AppError('CONTENT_GROUP_NAME_EXISTS', '이미 사용 중인 그룹 이름입니다.', 409);
    }
  }

  private rethrowUniqueName(error: unknown): never {
    if (isUniqueConstraintError(error)) {
      throw new AppError('CONTENT_GROUP_NAME_EXISTS', '이미 사용 중인 그룹 이름입니다.', 409);
    }
    throw error;
  }
}
