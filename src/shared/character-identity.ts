import type Database from 'better-sqlite3';

import { AppError } from './errors/app-error';

export type CharacterType = 'MAIN' | 'ALTERNATE';

export interface CharacterIdentity {
  characterKey: string;
  characterType: CharacterType;
  ownerUserId: number;
  ownerNickname: string;
  characterName: string;
  mainClass: string;
  combatPower: number;
}

export const makeCharacterKey = (characterType: CharacterType, ownerUserId: number): string =>
  `${characterType}:${ownerUserId}`;

export const parseCharacterKey = (
  value: string,
): { characterType: CharacterType; ownerUserId: number } | null => {
  const match = /^(MAIN|ALTERNATE):([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const ownerUserId = Number(match[2]);
  if (!Number.isSafeInteger(ownerUserId)) return null;
  return { characterType: match[1] as CharacterType, ownerUserId };
};

export const findCharacterIdentity = (
  db: Database.Database,
  guildId: number,
  characterKey: string,
): CharacterIdentity | null => {
  const parsed = parseCharacterKey(characterKey);
  if (!parsed) return null;
  const row =
    parsed.characterType === 'MAIN'
      ? (db
          .prepare(
            `
              SELECT
                u.id AS owner_user_id,
                u.nickname AS owner_nickname,
                u.nickname AS character_name,
                COALESCE(c.main_class, '') AS main_class,
                COALESCE(c.combat_power, 0) AS combat_power
              FROM users AS u
              LEFT JOIN characters AS c ON c.user_id = u.id
              WHERE u.id = ? AND u.guild_id = ? AND u.is_active = 1
              LIMIT 1
            `,
          )
          .get(parsed.ownerUserId, guildId) as CharacterIdentityRow | undefined)
      : (db
          .prepare(
            `
              SELECT
                u.id AS owner_user_id,
                u.nickname AS owner_nickname,
                ac.character_name,
                ac.main_class,
                COALESCE(c.combat_power, 0) AS combat_power
              FROM alternate_characters AS ac
              JOIN users AS u ON u.id = ac.user_id
              LEFT JOIN characters AS c ON c.user_id = u.id
              WHERE u.id = ? AND u.guild_id = ? AND u.is_active = 1
              LIMIT 1
            `,
          )
          .get(parsed.ownerUserId, guildId) as CharacterIdentityRow | undefined);
  if (!row) return null;
  return {
    characterKey,
    characterType: parsed.characterType,
    ownerUserId: row.owner_user_id,
    ownerNickname: row.owner_nickname,
    characterName: row.character_name,
    mainClass: row.main_class,
    combatPower: row.combat_power,
  };
};

interface CharacterIdentityRow {
  owner_user_id: number;
  owner_nickname: string;
  character_name: string;
  main_class: string;
  combat_power: number;
}

export const requireCharacterIdentity = (
  db: Database.Database,
  guildId: number,
  characterKey: string,
): CharacterIdentity => {
  const character = findCharacterIdentity(db, guildId, characterKey);
  if (!character) {
    throw new AppError('DEPUTY_CHARACTER_NOT_FOUND', '같은 길드의 캐릭터를 찾을 수 없습니다.', 404);
  }
  return character;
};
