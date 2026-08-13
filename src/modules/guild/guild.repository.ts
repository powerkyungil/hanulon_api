import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type {
  GuildActor,
  GuildAuditAction,
  GuildInvite,
  GuildSettings,
  GuildSettingsUpdate,
  InviteRole,
} from './guild.types';

interface ActorRow {
  id: number;
  guild_id: number;
  role: UserRole;
  is_active: number;
}

interface SettingsRow {
  guild_id: number;
  guild_name: string;
  allow_member_combat_power_edit: number;
}

interface InviteRow {
  code: string;
  role: InviteRole;
}

export class GuildRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): GuildActor | null {
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

  public findSettings(guildId: number): GuildSettings | null {
    const row = this.db
      .prepare(
        `
          SELECT guild_id, guild_name, allow_member_combat_power_edit
          FROM guild_settings
          WHERE guild_id = ?
          LIMIT 1
        `,
      )
      .get(guildId) as SettingsRow | undefined;

    if (!row) return null;
    return {
      guildId: row.guild_id,
      guildName: row.guild_name,
      allowMemberCombatPowerEdit: row.allow_member_combat_power_edit === 1,
    };
  }

  public guildNameExistsForAnotherGuild(guildId: number, guildName: string): boolean {
    const row = this.db
      .prepare(
        `
          SELECT 1 AS found
          FROM guilds
          WHERE id <> ? AND name = ? COLLATE NOCASE
          LIMIT 1
        `,
      )
      .get(guildId, guildName) as { found: number } | undefined;
    return row?.found === 1;
  }

  public updateSettings(
    actor: GuildActor,
    current: GuildSettings,
    input: GuildSettingsUpdate,
  ): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE guilds
            SET name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
        )
        .run(input.guildName, actor.guildId);
      this.db
        .prepare(
          `
            UPDATE guild_settings
            SET guild_name = ?,
                allow_member_combat_power_edit = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ?
          `,
        )
        .run(input.guildName, input.allowMemberCombatPowerEdit ? 1 : 0, actor.guildId);
      this.insertAudit(actor, 'SETTINGS_UPDATED', {
        previousGuildName: current.guildName,
        nextGuildName: input.guildName,
        previousAllowMemberCombatPowerEdit: current.allowMemberCombatPowerEdit,
        nextAllowMemberCombatPowerEdit: input.allowMemberCombatPowerEdit,
      });
    });
  }

  public findInvites(guildId: number): GuildInvite[] {
    const rows = this.db
      .prepare(
        `
          SELECT code, role
          FROM invites
          WHERE guild_id = ?
          ORDER BY CASE role WHEN 'MEMBER' THEN 0 ELSE 1 END
        `,
      )
      .all(guildId) as InviteRow[];
    return rows.map((row) => ({ inviteCode: row.code, role: row.role }));
  }

  public findInvite(guildId: number, role: InviteRole): GuildInvite | null {
    const row = this.db
      .prepare(
        `
          SELECT code, role
          FROM invites
          WHERE guild_id = ? AND role = ?
          LIMIT 1
        `,
      )
      .get(guildId, role) as InviteRow | undefined;
    return row ? { inviteCode: row.code, role: row.role } : null;
  }

  public inviteCodeExists(code: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS found FROM invites WHERE code = ? COLLATE NOCASE LIMIT 1')
      .get(code) as { found: number } | undefined;
    return row?.found === 1;
  }

  public replaceInvite(
    actor: GuildActor,
    role: InviteRole,
    inviteCode: string,
    generated: boolean,
  ): GuildInvite {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            INSERT INTO invites (guild_id, code, role)
            VALUES (?, ?, ?)
            ON CONFLICT(guild_id, role) DO UPDATE SET
              code = excluded.code,
              created_at = CURRENT_TIMESTAMP
          `,
        )
        .run(actor.guildId, inviteCode, role);
      this.insertAudit(actor, 'INVITE_REPLACED', { role, generated });
    });
    return { inviteCode, role };
  }

  private insertAudit(
    actor: GuildActor,
    action: GuildAuditAction,
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO guild_audit_logs (
            guild_id,
            actor_user_id,
            action,
            metadata_json
          )
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, action, JSON.stringify(metadata));
  }
}
