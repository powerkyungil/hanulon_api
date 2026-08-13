import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type {
  SupportActor,
  SupportApplication,
  SupportApplicationStatus,
  SupportApplicationSummary,
  SupportAuditAction,
  SupportRequest,
  SupportRequestInput,
  SupportRequestStatus,
  SupportRequestSummary,
} from './support.types';

interface ActorRow {
  id: number;
  guild_id: number;
  role: UserRole;
  is_active: number;
}

interface RequestRow {
  id: number;
  guild_id: number;
  requester_id: number;
  requested_time: string;
  memo: string;
  status: SupportRequestStatus;
  selected_application_id: number | null;
  created_at_ms: number;
  updated_at_ms: number;
  nickname: string;
  occupation: string | null;
  main_class: string | null;
  combat_power: number | null;
}

interface RequestSummaryRow {
  id: number;
  guild_id: number;
  requester_id: number;
  status: SupportRequestStatus;
  selected_application_id: number | null;
}

interface ApplicationRow {
  id: number;
  request_id: number;
  applicant_id: number;
  memo: string;
  status: SupportApplicationStatus;
  created_at_ms: number;
  nickname: string;
  occupation: string | null;
  main_class: string | null;
  combat_power: number | null;
}

interface ApplicationSummaryRow {
  id: number;
  request_id: number;
  applicant_id: number;
  status: SupportApplicationStatus;
}

const mapRequestSummary = (row: RequestSummaryRow): SupportRequestSummary => ({
  id: row.id,
  guildId: row.guild_id,
  requesterId: row.requester_id,
  status: row.status,
  selectedApplicationId: row.selected_application_id,
});

const mapApplicationSummary = (row: ApplicationSummaryRow): SupportApplicationSummary => ({
  id: row.id,
  requestId: row.request_id,
  applicantId: row.applicant_id,
  status: row.status,
});

export class SupportRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): SupportActor | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, role, is_active
          FROM users
          WHERE id = ? AND guild_id = ?
          LIMIT 1
        `,
      )
      .get(userId, guildId) as ActorRow | undefined;

    if (!row) return null;
    return {
      id: row.id,
      guildId: row.guild_id,
      role: row.role,
      isActive: row.is_active === 1,
    };
  }

  public findRequests(guildId: number): SupportRequest[] {
    const requestRows = this.db
      .prepare(
        `
          SELECT
            sr.id,
            sr.guild_id,
            sr.requester_id,
            sr.requested_time,
            sr.memo,
            sr.status,
            sr.selected_application_id,
            CAST(strftime('%s', sr.created_at) AS INTEGER) * 1000 AS created_at_ms,
            CAST(strftime('%s', sr.updated_at) AS INTEGER) * 1000 AS updated_at_ms,
            u.nickname,
            c.occupation,
            c.main_class,
            c.combat_power
          FROM support_requests AS sr
          JOIN users AS u ON u.id = sr.requester_id
          LEFT JOIN characters AS c ON c.user_id = u.id
          WHERE sr.guild_id = ?
          ORDER BY
            CASE sr.status WHEN 'OPEN' THEN 0 WHEN 'MATCHED' THEN 1 ELSE 2 END,
            sr.created_at DESC,
            sr.id DESC
        `,
      )
      .all(guildId) as RequestRow[];

    const applicationRows = this.db
      .prepare(
        `
          SELECT
            sa.id,
            sa.request_id,
            sa.applicant_id,
            sa.memo,
            sa.status,
            CAST(strftime('%s', sa.created_at) AS INTEGER) * 1000 AS created_at_ms,
            u.nickname,
            c.occupation,
            c.main_class,
            c.combat_power
          FROM support_applications AS sa
          JOIN support_requests AS sr ON sr.id = sa.request_id
          JOIN users AS u ON u.id = sa.applicant_id
          LEFT JOIN characters AS c ON c.user_id = u.id
          WHERE sr.guild_id = ?
          ORDER BY
            CASE sa.status WHEN 'SELECTED' THEN 0 ELSE 1 END,
            c.combat_power DESC,
            sa.created_at ASC,
            sa.id ASC
        `,
      )
      .all(guildId) as ApplicationRow[];

    const applicationsByRequest = new Map<number, SupportApplication[]>();
    applicationRows.forEach((row) => {
      const application: SupportApplication = {
        id: row.id,
        requestId: row.request_id,
        applicantId: row.applicant_id,
        memo: row.memo,
        status: row.status,
        createdAt: row.created_at_ms,
        nickname: row.nickname,
        occupation: row.occupation ?? '',
        mainClass: row.main_class ?? '',
        combatPower: row.combat_power ?? 0,
      };
      const applications = applicationsByRequest.get(row.request_id) ?? [];
      applications.push(application);
      applicationsByRequest.set(row.request_id, applications);
    });

    return requestRows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      requesterId: row.requester_id,
      requestedTime: row.requested_time,
      memo: row.memo,
      status: row.status,
      selectedApplicationId: row.selected_application_id,
      createdAt: row.created_at_ms,
      updatedAt: row.updated_at_ms,
      nickname: row.nickname,
      occupation: row.occupation ?? '',
      mainClass: row.main_class ?? '',
      combatPower: row.combat_power ?? 0,
      applications: applicationsByRequest.get(row.id) ?? [],
    }));
  }

  public findRequest(guildId: number, requestId: number): SupportRequestSummary | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, requester_id, status, selected_application_id
          FROM support_requests
          WHERE guild_id = ? AND id = ?
          LIMIT 1
        `,
      )
      .get(guildId, requestId) as RequestSummaryRow | undefined;
    return row ? mapRequestSummary(row) : null;
  }

  public findApplication(
    guildId: number,
    requestId: number,
    applicationId: number,
  ): SupportApplicationSummary | null {
    const row = this.db
      .prepare(
        `
          SELECT sa.id, sa.request_id, sa.applicant_id, sa.status
          FROM support_applications AS sa
          JOIN support_requests AS sr ON sr.id = sa.request_id
          WHERE sr.guild_id = ? AND sa.request_id = ? AND sa.id = ?
          LIMIT 1
        `,
      )
      .get(guildId, requestId, applicationId) as ApplicationSummaryRow | undefined;
    return row ? mapApplicationSummary(row) : null;
  }

  public createRequest(actor: SupportActor, input: SupportRequestInput): number {
    return withTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `
            INSERT INTO support_requests (guild_id, requester_id, requested_time, memo)
            VALUES (?, ?, ?, ?)
          `,
        )
        .run(actor.guildId, actor.id, input.requestedTime, input.memo);
      const requestId = Number(result.lastInsertRowid);
      this.insertAudit(actor, requestId, 'REQUEST_CREATED', {});
      return requestId;
    });
  }

  public updateStatus(
    actor: SupportActor,
    request: SupportRequestSummary,
    status: Exclude<SupportRequestStatus, 'MATCHED'>,
  ): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE support_requests
            SET status = ?,
                selected_application_id = CASE WHEN ? = 'OPEN' THEN NULL ELSE selected_application_id END,
                updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND id = ?
          `,
        )
        .run(status, status, actor.guildId, request.id);
      if (status === 'OPEN') {
        this.db
          .prepare(
            `
              UPDATE support_applications
              SET status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
              WHERE request_id = ? AND status = 'SELECTED'
            `,
          )
          .run(request.id);
      }
      this.insertAudit(actor, request.id, 'REQUEST_STATUS_CHANGED', {
        previousStatus: request.status,
        nextStatus: status,
      });
    });
  }

  public deleteRequest(actor: SupportActor, request: SupportRequestSummary): void {
    withTransaction(this.db, () => {
      this.insertAudit(actor, request.id, 'REQUEST_DELETED', {
        previousStatus: request.status,
      });
      this.db
        .prepare('DELETE FROM support_requests WHERE guild_id = ? AND id = ?')
        .run(actor.guildId, request.id);
    });
  }

  public createApplication(actor: SupportActor, requestId: number, memo: string): number {
    return withTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `
            INSERT INTO support_applications (request_id, applicant_id, memo)
            VALUES (?, ?, ?)
          `,
        )
        .run(requestId, actor.id, memo);
      const applicationId = Number(result.lastInsertRowid);
      this.insertAudit(actor, requestId, 'APPLICATION_CREATED', { applicationId });
      return applicationId;
    });
  }

  public cancelApplication(
    actor: SupportActor,
    request: SupportRequestSummary,
    application: SupportApplicationSummary,
  ): void {
    withTransaction(this.db, () => {
      this.db
        .prepare('DELETE FROM support_applications WHERE request_id = ? AND id = ?')
        .run(request.id, application.id);
      if (application.status === 'SELECTED') {
        this.db
          .prepare(
            `
              UPDATE support_requests
              SET status = 'OPEN', selected_application_id = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE guild_id = ? AND id = ?
            `,
          )
          .run(actor.guildId, request.id);
      }
      this.insertAudit(actor, request.id, 'APPLICATION_CANCELED', {
        applicationId: application.id,
        selected: application.status === 'SELECTED',
      });
    });
  }

  public selectApplication(
    actor: SupportActor,
    request: SupportRequestSummary,
    application: SupportApplicationSummary,
  ): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE support_applications
            SET status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
          `,
        )
        .run(request.id);
      this.db
        .prepare(
          `
            UPDATE support_applications
            SET status = 'SELECTED', updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ? AND id = ?
          `,
        )
        .run(request.id, application.id);
      this.db
        .prepare(
          `
            UPDATE support_requests
            SET status = 'MATCHED', selected_application_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND id = ?
          `,
        )
        .run(application.id, actor.guildId, request.id);
      this.insertAudit(actor, request.id, 'APPLICATION_SELECTED', {
        applicationId: application.id,
        previousStatus: request.status,
      });
    });
  }

  private insertAudit(
    actor: SupportActor,
    requestId: number,
    action: SupportAuditAction,
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO support_audit_logs (
            guild_id,
            actor_user_id,
            request_id,
            action,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, requestId, action, JSON.stringify(metadata));
  }
}
