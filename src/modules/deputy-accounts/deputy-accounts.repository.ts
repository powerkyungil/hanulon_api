import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type {
  CharacterType,
  DeputyAccount,
  DeputyAccountCredentials,
  DeputyActor,
  DeputyCharacter,
} from './deputy-accounts.types';

interface AccountRow {
  id: number;
  guild_id: number;
  username: string;
  password_hash: string;
  nickname: string;
  active_character_key: string | null;
  is_active: number;
  token_version?: number;
  created_at: string;
}

const mapAccount = (row: AccountRow): DeputyAccount => ({
  id: row.id,
  guildId: row.guild_id,
  username: row.username,
  nickname: row.nickname,
  isActive: row.is_active === 1,
  activeCharacterKey: row.active_character_key,
  createdAt: row.created_at,
});

export class DeputyAccountsRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): DeputyActor | null {
    const row = this.db
      .prepare(
        'SELECT id, guild_id, role, is_active FROM users WHERE id = ? AND guild_id = ? LIMIT 1',
      )
      .get(userId, guildId) as
      { id: number; guild_id: number; role: UserRole; is_active: number } | undefined;
    return row
      ? { id: row.id, guildId: row.guild_id, role: row.role, isActive: row.is_active === 1 }
      : null;
  }

  public usernameExists(username: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `
            SELECT 1 AS found FROM users WHERE username = ? COLLATE NOCASE
            UNION ALL
            SELECT 1 AS found FROM deputy_accounts WHERE username = ? COLLATE NOCASE
            LIMIT 1
          `,
        )
        .get(username, username),
    );
  }

  public createAccount(
    guildId: number,
    createdBy: number,
    username: string,
    passwordHash: string,
    nickname: string,
  ): number {
    return withTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `
            INSERT INTO deputy_accounts (guild_id, username, password_hash, nickname, created_by)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(guildId, username, passwordHash, nickname, createdBy);
      const id = Number(result.lastInsertRowid);
      this.insertAudit(guildId, createdBy, id, 'ACCOUNT_CREATED', { username, nickname });
      return id;
    });
  }

  public findAccounts(guildId: number): DeputyAccount[] {
    return (
      this.db
        .prepare(
          `
            SELECT id, guild_id, username, password_hash, nickname,
              active_character_key, is_active, created_at
            FROM deputy_accounts
            WHERE guild_id = ?
            ORDER BY id ASC
          `,
        )
        .all(guildId) as AccountRow[]
    ).map(mapAccount);
  }

  public findAccount(guildId: number, id: number): DeputyAccount | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, username, password_hash, nickname,
            active_character_key, is_active, created_at
          FROM deputy_accounts
          WHERE guild_id = ? AND id = ?
          LIMIT 1
        `,
      )
      .get(guildId, id) as AccountRow | undefined;
    return row ? mapAccount(row) : null;
  }

  public findCredentialsByUsername(username: string): DeputyAccountCredentials | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, username, password_hash, nickname,
            active_character_key, is_active, token_version, created_at
          FROM deputy_accounts
          WHERE username = ? COLLATE NOCASE
          LIMIT 1
        `,
      )
      .get(username) as AccountRow | undefined;
    return row
      ? {
          ...mapAccount(row),
          passwordHash: row.password_hash,
          tokenVersion: row.token_version ?? 0,
        }
      : null;
  }

  public findAccountById(id: number): DeputyAccount | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, username, password_hash, nickname,
            active_character_key, is_active, created_at
          FROM deputy_accounts
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(id) as AccountRow | undefined;
    return row ? mapAccount(row) : null;
  }

  public updatePassword(
    guildId: number,
    actorUserId: number,
    id: number,
    passwordHash: string,
  ): boolean {
    return withTransaction(this.db, () => {
      const changed =
        this.db
          .prepare(
            `
            UPDATE deputy_accounts
            SET password_hash = ?, token_version = token_version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND id = ?
          `,
          )
          .run(passwordHash, guildId, id).changes === 1;
      if (changed) this.insertAudit(guildId, actorUserId, id, 'PASSWORD_RESET', {});
      return changed;
    });
  }

  public setActive(guildId: number, actorUserId: number, id: number, isActive: boolean): boolean {
    return withTransaction(this.db, () => {
      const changed =
        this.db
          .prepare(
            `
            UPDATE deputy_accounts
            SET is_active = ?,
                active_character_key = CASE WHEN ? = 1 THEN active_character_key ELSE NULL END,
                token_version = token_version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND id = ?
          `,
          )
          .run(isActive ? 1 : 0, isActive ? 1 : 0, guildId, id).changes === 1;
      if (changed) {
        this.insertAudit(
          guildId,
          actorUserId,
          id,
          isActive ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED',
          {},
        );
      }
      return changed;
    });
  }

  public findCharacters(guildId: number): DeputyCharacter[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            'MAIN' AS character_type,
            u.id AS owner_user_id,
            u.nickname AS owner_nickname,
            u.nickname AS character_name,
            COALESCE(c.main_class, '') AS main_class,
            COALESCE(c.combat_power, 0) AS combat_power
          FROM users AS u
          LEFT JOIN characters AS c ON c.user_id = u.id
          WHERE u.guild_id = ? AND u.is_active = 1
          UNION ALL
          SELECT
            'ALTERNATE' AS character_type,
            u.id AS owner_user_id,
            u.nickname AS owner_nickname,
            ac.character_name AS character_name,
            ac.main_class AS main_class,
            COALESCE(c.combat_power, 0) AS combat_power
          FROM alternate_characters AS ac
          JOIN users AS u ON u.id = ac.user_id
          LEFT JOIN characters AS c ON c.user_id = u.id
          WHERE u.guild_id = ? AND u.is_active = 1
          ORDER BY owner_nickname COLLATE NOCASE ASC, character_type ASC, character_name COLLATE NOCASE ASC
        `,
      )
      .all(guildId, guildId) as Array<{
      character_type: CharacterType;
      owner_user_id: number;
      owner_nickname: string;
      character_name: string;
      main_class: string;
      combat_power: number;
    }>;

    return rows.map((row) => ({
      characterKey: `${row.character_type}:${row.owner_user_id}`,
      characterType: row.character_type,
      ownerUserId: row.owner_user_id,
      ownerNickname: row.owner_nickname,
      characterName: row.character_name,
      mainClass: row.main_class,
      combatPower: row.combat_power,
    }));
  }

  public selectCharacter(deputyId: number, guildId: number, characterKey: string): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE deputy_accounts
            SET active_character_key = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND guild_id = ? AND is_active = 1
          `,
        )
        .run(characterKey, deputyId, guildId);
      this.insertAudit(guildId, null, deputyId, 'CHARACTER_SELECTED', { characterKey }, deputyId);
    });
  }

  public updateNickname(guildId: number, deputyId: number, nickname: string): void {
    withTransaction(this.db, () => {
      const account = this.findAccount(guildId, deputyId);
      if (!account) return;
      if (account.nickname === nickname) return;

      this.db
        .prepare(
          `
            UPDATE deputy_accounts
            SET nickname = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND guild_id = ? AND is_active = 1
          `,
        )
        .run(nickname, deputyId, guildId);
      this.insertAudit(
        guildId,
        null,
        deputyId,
        'NICKNAME_UPDATED',
        {
          previousNickname: account.nickname,
          nickname,
        },
        deputyId,
      );
    });
  }

  private insertAudit(
    guildId: number,
    actorUserId: number | null,
    deputyId: number,
    action:
      | 'ACCOUNT_CREATED'
      | 'PASSWORD_RESET'
      | 'ACCOUNT_ACTIVATED'
      | 'ACCOUNT_DEACTIVATED'
      | 'CHARACTER_SELECTED'
      | 'NICKNAME_UPDATED',
    metadata: Record<string, unknown>,
    actorDeputyId: number | null = null,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO deputy_account_audit_logs (
            guild_id, actor_user_id, actor_deputy_id, deputy_account_id, action, metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(guildId, actorUserId, actorDeputyId, deputyId, action, JSON.stringify(metadata));
  }
}
