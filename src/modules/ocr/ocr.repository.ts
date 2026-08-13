import type Database from 'better-sqlite3';

import type { UserRole } from '../auth/auth.types';

interface ActorRow {
  role: UserRole;
  is_active: number;
}

export class OcrRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): { role: UserRole; isActive: boolean } | null {
    const row = this.db
      .prepare('SELECT role, is_active FROM users WHERE id = ? AND guild_id = ?')
      .get(userId, guildId) as ActorRow | undefined;
    return row ? { role: row.role, isActive: row.is_active === 1 } : null;
  }
}
