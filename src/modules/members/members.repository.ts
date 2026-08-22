import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { Equipment, Skills, UserRole } from '../auth/auth.types';
import type {
  AccountDeletionIdentity,
  GuildProfileSettings,
  MemberAuditAction,
  ProfileIdentity,
  ProfileUpdateInput,
  UserProfile,
} from './members.types';

interface ProfileRow {
  id: number;
  guild_id: number;
  username: string;
  role: UserRole;
  nickname: string;
  is_active: number;
  occupation: string | null;
  main_class: string | null;
  combat_power: number | null;
  equipment_json: string | null;
  skills_json: string | null;
  max_crit_rate: number | null;
  max_crit_resist: number | null;
  status_effect_acc: number | null;
}

interface AlternateCharacterRow {
  id: number;
  character_name: string;
  main_class: string;
}

interface IdentityRow {
  id: number;
  guild_id: number;
  username: string;
  role: UserRole;
  nickname: string;
  is_active: number;
}

interface AccountDeletionIdentityRow extends IdentityRow {
  password_hash: string;
}

interface ProfileWithAlternateRow extends ProfileRow {
  alternate_id: number | null;
  alternate_character_name: string | null;
  alternate_main_class: string | null;
}

const parseObject = <T extends object>(value: string | null): T => {
  if (!value) return {} as T;

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as T)
      : ({} as T);
  } catch {
    return {} as T;
  }
};

const parseSkills = (value: string | null): Skills => {
  const parsed = parseObject<Partial<Skills>>(value);
  return {
    active: parsed.active ?? {},
    passive: parsed.passive ?? {},
  };
};

export class AccountDeletionStateConflictError extends Error {}
export class MasterAccountDeletionHasMembersError extends Error {}

export class MembersRepository {
  public constructor(private readonly db: Database.Database) {}

  public findIdentity(userId: number, guildId: number): ProfileIdentity | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, username, role, nickname, is_active
          FROM users
          WHERE id = ? AND guild_id = ?
          LIMIT 1
        `,
      )
      .get(userId, guildId) as IdentityRow | undefined;

    if (!row) return null;
    return {
      id: row.id,
      guildId: row.guild_id,
      username: row.username,
      role: row.role,
      nickname: row.nickname,
      isActive: row.is_active === 1,
    };
  }

  public findAccountForDeletion(userId: number, guildId: number): AccountDeletionIdentity | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, username, role, nickname, is_active, password_hash
          FROM users
          WHERE id = ? AND guild_id = ?
          LIMIT 1
        `,
      )
      .get(userId, guildId) as AccountDeletionIdentityRow | undefined;

    if (!row) return null;
    return {
      id: row.id,
      guildId: row.guild_id,
      username: row.username,
      role: row.role,
      nickname: row.nickname,
      isActive: row.is_active === 1,
      passwordHash: row.password_hash,
    };
  }

  public findProfile(userId: number, guildId: number): UserProfile | null {
    const row = this.db
      .prepare(
        `
          SELECT
            u.id,
            u.guild_id,
            u.username,
            u.role,
            u.nickname,
            u.is_active,
            c.occupation,
            c.main_class,
            c.combat_power,
            c.equipment_json,
            c.skills_json,
            c.max_crit_rate,
            c.max_crit_resist,
            c.status_effect_acc
          FROM users AS u
          LEFT JOIN characters AS c ON c.user_id = u.id
          WHERE u.id = ? AND u.guild_id = ?
          LIMIT 1
        `,
      )
      .get(userId, guildId) as ProfileRow | undefined;

    if (!row || row.is_active !== 1) return null;

    const alternateRows = this.db
      .prepare(
        `
          SELECT id, character_name, main_class
          FROM alternate_characters
          WHERE user_id = ?
          ORDER BY id ASC
        `,
      )
      .all(row.id) as AlternateCharacterRow[];

    return {
      id: row.id,
      guildId: row.guild_id,
      username: row.username,
      role: row.role,
      nickname: row.nickname,
      occupation: row.occupation,
      mainClass: row.main_class,
      combatPower: row.combat_power,
      equipment: parseObject<Equipment>(row.equipment_json),
      skills: parseSkills(row.skills_json),
      maxCritRate: row.max_crit_rate ?? 0,
      maxCritResist: row.max_crit_resist ?? 0,
      statusEffectAcc: row.status_effect_acc ?? 0,
      alternateCharacters: alternateRows.map((alternate) => ({
        id: alternate.id,
        characterName: alternate.character_name,
        mainClass: alternate.main_class,
      })),
    };
  }

  public findProfilesByGuild(guildId: number): UserProfile[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            u.id,
            u.guild_id,
            u.username,
            u.role,
            u.nickname,
            u.is_active,
            c.occupation,
            c.main_class,
            c.combat_power,
            c.equipment_json,
            c.skills_json,
            c.max_crit_rate,
            c.max_crit_resist,
            c.status_effect_acc,
            ac.id AS alternate_id,
            ac.character_name AS alternate_character_name,
            ac.main_class AS alternate_main_class
          FROM users AS u
          LEFT JOIN characters AS c ON c.user_id = u.id
          LEFT JOIN alternate_characters AS ac ON ac.user_id = u.id
          WHERE u.guild_id = ? AND u.is_active = 1
          ORDER BY
            CASE u.role WHEN 'MASTER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,
            c.combat_power DESC,
            u.nickname COLLATE NOCASE ASC,
            u.id ASC
        `,
      )
      .all(guildId) as ProfileWithAlternateRow[];

    return rows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      username: row.username,
      role: row.role,
      nickname: row.nickname,
      occupation: row.occupation,
      mainClass: row.main_class,
      combatPower: row.combat_power,
      equipment: parseObject<Equipment>(row.equipment_json),
      skills: parseSkills(row.skills_json),
      maxCritRate: row.max_crit_rate ?? 0,
      maxCritResist: row.max_crit_resist ?? 0,
      statusEffectAcc: row.status_effect_acc ?? 0,
      alternateCharacters:
        row.alternate_id === null ||
        row.alternate_character_name === null ||
        row.alternate_main_class === null
          ? []
          : [
              {
                id: row.alternate_id,
                characterName: row.alternate_character_name,
                mainClass: row.alternate_main_class,
              },
            ],
    }));
  }

  public findGuildProfileSettings(guildId: number): GuildProfileSettings | null {
    const row = this.db
      .prepare(
        `
          SELECT allow_member_combat_power_edit
          FROM guild_settings
          WHERE guild_id = ?
          LIMIT 1
        `,
      )
      .get(guildId) as { allow_member_combat_power_edit: number } | undefined;

    if (!row) return null;
    return { allowMemberCombatPowerEdit: row.allow_member_combat_power_edit === 1 };
  }

  public updateProfile(
    identity: ProfileIdentity,
    input: ProfileUpdateInput,
    passwordHash: string | null,
  ): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE users
            SET nickname = ?,
                password_hash = COALESCE(?, password_hash),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND guild_id = ? AND is_active = 1
          `,
        )
        .run(input.nickname, passwordHash, identity.id, identity.guildId);

      this.db
        .prepare(
          `
            INSERT INTO characters (
              user_id,
              occupation,
              main_class,
              combat_power,
              equipment_json,
              skills_json,
              max_crit_rate,
              max_crit_resist,
              status_effect_acc
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              occupation = excluded.occupation,
              main_class = excluded.main_class,
              combat_power = excluded.combat_power,
              equipment_json = excluded.equipment_json,
              skills_json = excluded.skills_json,
              max_crit_rate = excluded.max_crit_rate,
              max_crit_resist = excluded.max_crit_resist,
              status_effect_acc = excluded.status_effect_acc,
              updated_at = CURRENT_TIMESTAMP
          `,
        )
        .run(
          identity.id,
          input.occupation,
          input.mainClass,
          input.combatPower,
          JSON.stringify(input.equipment),
          JSON.stringify(input.skills),
          input.maxCritRate,
          input.maxCritResist,
          input.statusEffectAcc,
        );

      this.db.prepare('DELETE FROM alternate_characters WHERE user_id = ?').run(identity.id);
      if (input.alternateCharacters.length > 0) {
        const alternate = input.alternateCharacters[0];
        this.db
          .prepare(
            `
              INSERT INTO alternate_characters (user_id, character_name, main_class)
              VALUES (?, ?, ?)
            `,
          )
          .run(identity.id, alternate.characterName, alternate.mainClass);
      }
    });
  }

  public changeRole(
    actor: ProfileIdentity,
    target: ProfileIdentity,
    role: 'MEMBER' | 'ADMIN',
  ): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE users
            SET role = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND guild_id = ? AND is_active = 1
          `,
        )
        .run(role, target.id, actor.guildId);
      this.insertAudit(actor, target.id, 'ROLE_CHANGED', {
        previousRole: target.role,
        nextRole: role,
      });
    });
  }

  public transferMaster(actor: ProfileIdentity, target: ProfileIdentity): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE users
            SET role = 'MEMBER', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND guild_id = ? AND role = 'MASTER' AND is_active = 1
          `,
        )
        .run(actor.id, actor.guildId);
      this.db
        .prepare(
          `
            UPDATE users
            SET role = 'MASTER', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND guild_id = ? AND role IN ('MEMBER', 'ADMIN') AND is_active = 1
          `,
        )
        .run(target.id, actor.guildId);
      this.insertAudit(actor, target.id, 'MASTER_TRANSFERRED', {
        previousTargetRole: target.role,
      });
    });
  }

  public resetPassword(
    actor: ProfileIdentity,
    target: ProfileIdentity,
    passwordHash: string,
  ): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE users
            SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND guild_id = ? AND is_active = 1
          `,
        )
        .run(passwordHash, target.id, actor.guildId);
      this.insertAudit(actor, target.id, 'PASSWORD_RESET');
    });
  }

  public removeMember(actor: ProfileIdentity, target: ProfileIdentity): void {
    withTransaction(this.db, () => {
      this.insertAudit(actor, target.id, 'MEMBER_REMOVED', {
        targetRole: target.role,
        targetNickname: target.nickname,
      });
      this.db
        .prepare('DELETE FROM users WHERE id = ? AND guild_id = ? AND is_active = 1')
        .run(target.id, actor.guildId);
    });
  }

  public deleteAccount(identity: AccountDeletionIdentity): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE support_requests
            SET status = 'OPEN',
                selected_application_id = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ?
              AND requester_id <> ?
              AND selected_application_id IN (
                SELECT sa.id
                FROM support_applications AS sa
                INNER JOIN support_requests AS sr ON sr.id = sa.request_id
                WHERE sr.guild_id = ? AND sa.applicant_id = ?
              )
          `,
        )
        .run(identity.guildId, identity.id, identity.guildId, identity.id);

      this.deletePersonalAuditLogs(identity);
      this.anonymizeSharedResourceAttribution(identity);

      const deletion = this.db
        .prepare(
          `
            DELETE FROM users
            WHERE id = ?
              AND guild_id = ?
              AND is_active = 1
              AND role <> 'MASTER'
          `,
        )
        .run(identity.id, identity.guildId);

      if (deletion.changes !== 1) {
        throw new AccountDeletionStateConflictError();
      }
    });
  }

  public deleteSoleMasterAndGuild(identity: AccountDeletionIdentity): void {
    withTransaction(this.db, () => {
      const otherMember = this.db
        .prepare(
          `
            SELECT 1 AS found
            FROM users
            WHERE guild_id = ? AND id <> ?
            LIMIT 1
          `,
        )
        .get(identity.guildId, identity.id) as { found: number } | undefined;
      if (otherMember) {
        throw new MasterAccountDeletionHasMembersError();
      }

      const userDeletion = this.db
        .prepare(
          `
            DELETE FROM users
            WHERE id = ?
              AND guild_id = ?
              AND is_active = 1
              AND role = 'MASTER'
          `,
        )
        .run(identity.id, identity.guildId);
      if (userDeletion.changes !== 1) {
        throw new AccountDeletionStateConflictError();
      }

      const detachedGuildTables = [
        'member_audit_logs',
        'guild_audit_logs',
        'notice_audit_logs',
        'support_audit_logs',
        'collection_audit_logs',
        'content_group_audit_logs',
        'siege_audit_logs',
        'schedule_history',
        'boss_audit_logs',
        'schedule_audit_logs',
        'boss_vote_audit_logs',
      ];
      for (const table of detachedGuildTables) {
        this.db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(identity.guildId);
      }

      const guildDeletion = this.db
        .prepare('DELETE FROM guilds WHERE id = ?')
        .run(identity.guildId);
      if (guildDeletion.changes !== 1) {
        throw new AccountDeletionStateConflictError();
      }
    });
  }

  private deletePersonalAuditLogs(identity: AccountDeletionIdentity): void {
    const directAuditDeletes: Array<[string, unknown[]]> = [
      [
        `
          DELETE FROM member_audit_logs
          WHERE guild_id = ? AND (actor_user_id = ? OR target_user_id = ?)
        `,
        [identity.guildId, identity.id, identity.id],
      ],
      [
        'DELETE FROM guild_audit_logs WHERE guild_id = ? AND actor_user_id = ?',
        [identity.guildId, identity.id],
      ],
      [
        'DELETE FROM notice_audit_logs WHERE guild_id = ? AND actor_user_id = ?',
        [identity.guildId, identity.id],
      ],
      [
        `
          DELETE FROM support_audit_logs
          WHERE guild_id = ?
            AND (
              actor_user_id = ?
              OR request_id IN (
                SELECT id FROM support_requests WHERE guild_id = ? AND requester_id = ?
              )
              OR CAST(
                CASE
                  WHEN json_valid(metadata_json)
                  THEN json_extract(metadata_json, '$.applicationId')
                END AS INTEGER
              ) IN (
                SELECT sa.id
                FROM support_applications AS sa
                INNER JOIN support_requests AS sr ON sr.id = sa.request_id
                WHERE sr.guild_id = ? AND sa.applicant_id = ?
              )
            )
        `,
        [
          identity.guildId,
          identity.id,
          identity.guildId,
          identity.id,
          identity.guildId,
          identity.id,
        ],
      ],
      [
        `
          DELETE FROM collection_audit_logs
          WHERE guild_id = ?
            AND (
              actor_user_id = ?
              OR CAST(
                CASE
                  WHEN json_valid(metadata_json)
                  THEN json_extract(metadata_json, '$.userId')
                END AS INTEGER
              ) = ?
            )
        `,
        [identity.guildId, identity.id, identity.id],
      ],
      [
        `
          DELETE FROM content_group_audit_logs
          WHERE guild_id = ?
            AND (
              actor_user_id = ?
              OR EXISTS (
                SELECT 1
                FROM json_tree(
                  CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END
                )
                WHERE json_tree.key IN ('previousMemberIds', 'nextMemberIds')
                  AND json_tree.type = 'array'
                  AND EXISTS (
                    SELECT 1
                    FROM json_each(json_tree.value)
                    WHERE CAST(json_each.value AS INTEGER) = ?
                  )
              )
            )
        `,
        [identity.guildId, identity.id, identity.id],
      ],
      [
        `
          DELETE FROM siege_audit_logs
          WHERE guild_id = ? AND (actor_user_id = ? OR target_user_id = ?)
        `,
        [identity.guildId, identity.id, identity.id],
      ],
      [
        'DELETE FROM boss_audit_logs WHERE guild_id = ? AND actor_user_id = ?',
        [identity.guildId, identity.id],
      ],
      [
        'DELETE FROM schedule_audit_logs WHERE guild_id = ? AND actor_user_id = ?',
        [identity.guildId, identity.id],
      ],
      [
        `
          DELETE FROM boss_vote_audit_logs
          WHERE guild_id = ?
            AND (
              actor_user_id = ?
              OR CAST(
                CASE
                  WHEN json_valid(metadata_json)
                  THEN json_extract(metadata_json, '$.userId')
                END AS INTEGER
              ) = ?
            )
        `,
        [identity.guildId, identity.id, identity.id],
      ],
    ];

    for (const [sql, params] of directAuditDeletes) {
      this.db.prepare(sql).run(...params);
    }

    const auditTables = [
      'member_audit_logs',
      'guild_audit_logs',
      'notice_audit_logs',
      'support_audit_logs',
      'collection_audit_logs',
      'content_group_audit_logs',
      'siege_audit_logs',
      'boss_audit_logs',
      'schedule_audit_logs',
      'boss_vote_audit_logs',
    ];
    for (const table of auditTables) {
      this.db
        .prepare(
          `
            DELETE FROM ${table}
            WHERE guild_id = ?
              AND EXISTS (
                SELECT 1
                FROM json_tree(
                  CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END
                )
                WHERE json_tree.type = 'text'
                  AND json_tree.value IN (?, ?)
              )
          `,
        )
        .run(identity.guildId, identity.username, identity.nickname);
    }
  }

  private anonymizeSharedResourceAttribution(identity: AccountDeletionIdentity): void {
    const attributionUpdates = [
      'UPDATE notice_rules SET created_by = 0 WHERE guild_id = ? AND created_by = ?',
      'UPDATE price_guides SET created_by = 0 WHERE guild_id = ? AND created_by = ?',
      'UPDATE boss_controls SET updated_by = 0 WHERE guild_id = ? AND updated_by = ?',
      'UPDATE siege_records SET updated_by = 0 WHERE guild_id = ? AND updated_by = ?',
      'UPDATE boss_schedules SET created_by = 0 WHERE guild_id = ? AND created_by = ?',
      'UPDATE schedule_history SET created_by = 0 WHERE guild_id = ? AND created_by = ?',
      'UPDATE participation_states SET updated_by = 0 WHERE guild_id = ? AND updated_by = ?',
      'UPDATE manual_boss_votes SET created_by = 0 WHERE guild_id = ? AND created_by = ?',
    ];

    for (const sql of attributionUpdates) {
      this.db.prepare(sql).run(identity.guildId, identity.id);
    }
  }

  private insertAudit(
    actor: ProfileIdentity,
    targetUserId: number,
    action: MemberAuditAction,
    metadata: Record<string, unknown> = {},
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO member_audit_logs (
            guild_id,
            actor_user_id,
            target_user_id,
            action,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, targetUserId, action, JSON.stringify(metadata));
  }
}
