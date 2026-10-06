import type Database from 'better-sqlite3';

import { createRandomInviteCode } from '../../shared/invites/invite-code';

const CODE_GENERATION_ATTEMPTS = 100;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed');

export const insertDefaultMemberInvite = (
  db: Database.Database,
  guildId: number,
  generateCode: () => string = createRandomInviteCode,
): string => {
  const insert = db.prepare("INSERT INTO invites (guild_id, code, role) VALUES (?, ?, 'MEMBER')");
  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const code = generateCode();
    try {
      insert.run(guildId, code);
      return code;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }
  throw new Error('Failed to generate a unique default member invite code');
};

export const ensureDefaultMemberInvites = (db: Database.Database): void => {
  const guilds = db
    .prepare(
      `
        SELECT guilds.id
        FROM guilds
        WHERE NOT EXISTS (
          SELECT 1
          FROM invites
          WHERE invites.guild_id = guilds.id AND invites.role = 'MEMBER'
        )
        ORDER BY guilds.id ASC
      `,
    )
    .all() as Array<{ id: number }>;

  db.transaction(() => {
    for (const guild of guilds) insertDefaultMemberInvite(db, guild.id);
  })();
};
