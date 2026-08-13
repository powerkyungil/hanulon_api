import { AppError } from '../../shared/errors/app-error';
import { SupportRepository } from './support.repository';
import type {
  SupportActor,
  SupportApplicationSummary,
  SupportRequest,
  SupportRequestInput,
  SupportRequestStatus,
  SupportRequestSummary,
} from './support.types';

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed');

export class SupportService {
  public constructor(private readonly repository: SupportRepository) {}

  public getRequests(userId: number, guildId: number): SupportRequest[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findRequests(guildId);
  }

  public createRequest(userId: number, guildId: number, input: SupportRequestInput): number {
    const actor = this.requireActiveActor(userId, guildId);
    const normalized: SupportRequestInput = {
      requestedTime: input.requestedTime.trim(),
      memo: input.memo.trim(),
    };
    if (!normalized.requestedTime) {
      throw new AppError('VALIDATION_ERROR', '손지원 시간을 입력해 주세요.', 422, {
        field: 'requestedTime',
      });
    }
    return this.repository.createRequest(actor, normalized);
  }

  public updateStatus(
    userId: number,
    guildId: number,
    requestId: number,
    status: SupportRequestStatus,
  ): void {
    const actor = this.requireActiveActor(userId, guildId);
    const request = this.requireRequest(guildId, requestId);
    this.requireRequestManager(actor, request);
    if (status === 'MATCHED') {
      throw new AppError(
        'SUPPORT_STATUS_TRANSITION_INVALID',
        '매칭 상태는 지원자를 선택해서 변경해야 합니다.',
        409,
      );
    }
    if (request.status === status) return;
    this.repository.updateStatus(actor, request, status);
  }

  public deleteRequest(userId: number, guildId: number, requestId: number): void {
    const actor = this.requireActiveActor(userId, guildId);
    const request = this.requireRequest(guildId, requestId);
    this.requireRequestManager(actor, request);
    this.repository.deleteRequest(actor, request);
  }

  public createApplication(
    userId: number,
    guildId: number,
    requestId: number,
    memo: string,
  ): number {
    const actor = this.requireActiveActor(userId, guildId);
    const request = this.requireRequest(guildId, requestId);
    if (request.status !== 'OPEN') {
      throw new AppError(
        'SUPPORT_REQUEST_NOT_OPEN',
        '현재 지원자를 모집 중인 요청이 아닙니다.',
        409,
      );
    }
    if (request.requesterId === actor.id) {
      throw new AppError(
        'SUPPORT_SELF_APPLICATION_FORBIDDEN',
        '본인 요청에는 신청할 수 없습니다.',
        422,
      );
    }

    try {
      return this.repository.createApplication(actor, request.id, memo.trim());
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError('SUPPORT_ALREADY_APPLIED', '이미 신청한 요청입니다.', 409);
      }
      throw error;
    }
  }

  public cancelApplication(
    userId: number,
    guildId: number,
    requestId: number,
    applicationId: number,
  ): void {
    const actor = this.requireActiveActor(userId, guildId);
    const request = this.requireRequest(guildId, requestId);
    const application = this.requireApplication(guildId, requestId, applicationId);
    if (application.applicantId !== actor.id && !this.isManager(actor)) {
      throw new AppError(
        'SUPPORT_APPLICATION_CANCEL_FORBIDDEN',
        '본인 신청 또는 운영진만 취소할 수 있습니다.',
        403,
      );
    }
    this.repository.cancelApplication(actor, request, application);
  }

  public selectApplication(
    userId: number,
    guildId: number,
    requestId: number,
    applicationId: number,
  ): void {
    const actor = this.requireActiveActor(userId, guildId);
    const request = this.requireRequest(guildId, requestId);
    this.requireRequestManager(actor, request);
    if (request.status !== 'OPEN' && request.status !== 'MATCHED') {
      throw new AppError(
        'SUPPORT_REQUEST_NOT_SELECTABLE',
        '종료된 요청은 다시 모집한 후 지원자를 선택해 주세요.',
        409,
      );
    }
    const application = this.requireApplication(guildId, requestId, applicationId);
    if (request.selectedApplicationId === application.id && application.status === 'SELECTED') {
      return;
    }
    this.repository.selectApplication(actor, request, application);
  }

  private requireActiveActor(userId: number, guildId: number): SupportActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    return actor;
  }

  private requireRequest(guildId: number, requestId: number): SupportRequestSummary {
    const request = this.repository.findRequest(guildId, requestId);
    if (!request) {
      throw new AppError('SUPPORT_REQUEST_NOT_FOUND', '손지원 요청을 찾을 수 없습니다.', 404);
    }
    return request;
  }

  private requireApplication(
    guildId: number,
    requestId: number,
    applicationId: number,
  ): SupportApplicationSummary {
    const application = this.repository.findApplication(guildId, requestId, applicationId);
    if (!application) {
      throw new AppError('SUPPORT_APPLICATION_NOT_FOUND', '손지원 신청을 찾을 수 없습니다.', 404);
    }
    return application;
  }

  private requireRequestManager(actor: SupportActor, request: SupportRequestSummary): void {
    if (request.requesterId !== actor.id && !this.isManager(actor)) {
      throw new AppError(
        'SUPPORT_REQUEST_MANAGE_FORBIDDEN',
        '요청자 또는 운영진만 이 작업을 수행할 수 있습니다.',
        403,
      );
    }
  }

  private isManager(actor: SupportActor): boolean {
    return actor.role === 'MASTER' || actor.role === 'ADMIN';
  }
}
