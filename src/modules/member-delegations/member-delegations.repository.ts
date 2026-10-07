import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type {
  DelegationUser,
  MemberDelegation,
  MemberDelegationLists,
} from './member-delegations.types';

interface UserRow {
  id: number;
  guild_id: number;
  username: string;
  nickname: string;
  role: UserRole;
  is_active: number;
}

interface DelegationRow {
  id: number;
  guild_id: number;
  owner_user_id: number;
  owner_username: string;
  owner_nickname: string;
  deputy_user_id: number;
  deputy_username: string;
  deputy_nickname: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

const mapUser = (row: UserRow): DelegationUser => ({
  id: row.id,
  guildId: row.guild_id,
  username: row.username,
  nickname: row.nickname,
  role: row.role,
  isActive: row.is_active === 1,
});

const mapDelegation = (row: DelegationRow): MemberDelegation => ({
  id: row.id,
  guildId: row.guild_id,
  ownerUserId: row.owner_user_id,
  ownerUsername: row.owner_username,
  ownerNickname: row.owner_nickname,
  deputyUserId: row.deputy_user_id,
  deputyUsername: row.deputy_username,
  deputyNickname: row.deputy_nickname,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  revokedAt: row.revoked_at,
});

export class MemberDelegationsRepository {
  public constructor(private readonly db: Database.Database) {}

  public findUser(userId: number, guildId: number): DelegationUser | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, username, nickname, role, is_active
          FROM users
          WHERE id = ? AND guild_id = ?
          LIMIT 1
        `,
      )
      .get(userId, guildId) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  public findLists(guildId: number, userId: number): MemberDelegationLists {
    const rows = this.db
      .prepare(
        `
          SELECT
            d.id,
            d.guild_id,
            d.owner_user_id,
            owner.username AS owner_username,
            owner.nickname AS owner_nickname,
            d.deputy_user_id,
            deputy.username AS deputy_username,
            deputy.nickname AS deputy_nickname,
            d.is_active,
            d.created_at,
            d.updated_at,
            d.revoked_at
          FROM member_delegations AS d
          JOIN users AS owner ON owner.id = d.owner_user_id
          JOIN users AS deputy ON deputy.id = d.deputy_user_id
          WHERE d.guild_id = ?
            AND (d.owner_user_id = ? OR d.deputy_user_id = ?)
          ORDER BY d.is_active DESC, d.created_at DESC, d.id DESC
        `,
      )
      .all(guildId, userId, userId) as DelegationRow[];

    return {
      owned: rows.filter((row) => row.owner_user_id === userId).map(mapDelegation),
      received: rows.filter((row) => row.deputy_user_id === userId).map(mapDelegation),
    };
  }

  public findDelegation(
    guildId: number,
    ownerUserId: number,
    deputyUserId: number,
  ): MemberDelegation | null {
    const row = this.db
      .prepare(
        `
          SELECT
            d.id,
            d.guild_id,
            d.owner_user_id,
            owner.username AS owner_username,
            owner.nickname AS owner_nickname,
            d.deputy_user_id,
            deputy.username AS deputy_username,
            deputy.nickname AS deputy_nickname,
            d.is_active,
            d.created_at,
            d.updated_at,
            d.revoked_at
          FROM member_delegations AS d
          JOIN users AS owner ON owner.id = d.owner_user_id
          JOIN users AS deputy ON deputy.id = d.deputy_user_id
          WHERE d.guild_id = ? AND d.owner_user_id = ? AND d.deputy_user_id = ?
          LIMIT 1
        `,
      )
      .get(guildId, ownerUserId, deputyUserId) as DelegationRow | undefined;
    return row ? mapDelegation(row) : null;
  }

  public grant(guildId: number, ownerUserId: number, deputyUserId: number): MemberDelegation {
    return withTransaction(this.db, () => {
      const previous = this.findDelegation(guildId, ownerUserId, deputyUserId);
      this.db
        .prepare(
          `
            INSERT INTO member_delegations (
              guild_id, owner_user_id, deputy_user_id, is_active, revoked_at
            )
            VALUES (?, ?, ?, 1, NULL)
            ON CONFLICT(guild_id, owner_user_id, deputy_user_id)
            DO UPDATE SET
              is_active = 1,
              updated_at = CURRENT_TIMESTAMP,
              revoked_at = NULL
          `,
        )
        .run(guildId, ownerUserId, deputyUserId);

      const delegation = this.findDelegation(guildId, ownerUserId, deputyUserId);
      if (!delegation) throw new Error('MEMBER_DELEGATION_NOT_FOUND_AFTER_GRANT');
      if (!previous?.isActive) {
        this.insertAudit(guildId, ownerUserId, ownerUserId, deputyUserId, 'DELEGATION_GRANTED', {
          reactivated: previous !== null,
        });
      }
      return delegation;
    });
  }

  public revoke(guildId: number, ownerUserId: number, deputyUserId: number): boolean {
    return withTransaction(this.db, () => {
      const delegation = this.findDelegation(guildId, ownerUserId, deputyUserId);
      if (!delegation?.isActive) return false;

      this.db
        .prepare(
          `
            UPDATE member_delegations
            SET is_active = 0,
                updated_at = CURRENT_TIMESTAMP,
                revoked_at = CURRENT_TIMESTAMP
            WHERE id = ? AND guild_id = ?
          `,
        )
        .run(delegation.id, guildId);
      this.insertAudit(guildId, ownerUserId, ownerUserId, deputyUserId, 'DELEGATION_REVOKED', {});
      return true;
    });
  }

  private insertAudit(
    guildId: number,
    actorUserId: number,
    ownerUserId: number,
    deputyUserId: number,
    action: 'DELEGATION_GRANTED' | 'DELEGATION_REVOKED',
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO member_delegation_audit_logs (
            guild_id, actor_user_id, owner_user_id, deputy_user_id, action, metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(guildId, actorUserId, ownerUserId, deputyUserId, action, JSON.stringify(metadata));
  }
}
