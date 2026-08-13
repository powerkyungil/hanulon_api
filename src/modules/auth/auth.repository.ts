import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { AuthUser, CharacterProfileInput, RegistrationResult, UserRole } from './auth.types';

interface UserRow {
  id: number;
  guild_id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  nickname: string;
  is_active: number;
}

interface InviteRow {
  guild_id: number;
  role: Exclude<UserRole, 'MASTER'>;
}

export interface NewUserInput {
  guildId: number;
  username: string;
  passwordHash: string;
  role: UserRole;
  nickname: string;
  profile: CharacterProfileInput;
}

export class AuthRepository {
  public constructor(private readonly db: Database.Database) {}

  public findUserByUsername(username: string): AuthUser | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, username, password_hash, role, nickname, is_active
          FROM users
          WHERE username = ? COLLATE NOCASE
          LIMIT 1
        `,
      )
      .get(username) as UserRow | undefined;

    if (!row) return null;

    return {
      id: row.id,
      guildId: row.guild_id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      nickname: row.nickname,
      isActive: row.is_active === 1,
    };
  }

  public guildExistsByName(name: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS found FROM guilds WHERE name = ? COLLATE NOCASE LIMIT 1')
      .get(name) as { found: number } | undefined;
    return row?.found === 1;
  }

  public findInviteByCode(code: string): InviteRow | null {
    const row = this.db
      .prepare(
        `
          SELECT guild_id, role
          FROM invites
          WHERE code = ? COLLATE NOCASE
          LIMIT 1
        `,
      )
      .get(code) as InviteRow | undefined;

    return row ?? null;
  }

  public createGuildWithUser(
    guildName: string,
    user: Omit<NewUserInput, 'guildId' | 'role'>,
  ): RegistrationResult {
    return withTransaction(this.db, () => {
      const guildInsert = this.db.prepare('INSERT INTO guilds (name) VALUES (?)').run(guildName);
      const guildId = Number(guildInsert.lastInsertRowid);

      this.db
        .prepare(
          `
            INSERT INTO guild_settings (guild_id, guild_name)
            VALUES (?, ?)
          `,
        )
        .run(guildId, guildName);

      const userId = this.insertUser({
        ...user,
        guildId,
        role: 'MASTER',
      });
      this.insertCharacter(userId, user.profile);

      return { userId, guildId, role: 'MASTER' };
    });
  }

  public createUserInGuild(user: NewUserInput): RegistrationResult {
    return withTransaction(this.db, () => {
      const userId = this.insertUser(user);
      this.insertCharacter(userId, user.profile);

      return { userId, guildId: user.guildId, role: user.role };
    });
  }

  private insertUser(user: NewUserInput): number {
    const result = this.db
      .prepare(
        `
          INSERT INTO users (guild_id, username, password_hash, role, nickname)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(user.guildId, user.username, user.passwordHash, user.role, user.nickname);

    return Number(result.lastInsertRowid);
  }

  private insertCharacter(userId: number, profile: CharacterProfileInput): void {
    this.db
      .prepare(
        `
          INSERT INTO characters (
            user_id,
            occupation,
            main_class,
            combat_power,
            equipment_json,
            skills_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        userId,
        profile.occupation,
        profile.mainClass,
        profile.combatPower,
        JSON.stringify(profile.equipment),
        JSON.stringify(profile.skills),
      );
  }
}
