export const userRoles = ['MASTER', 'ADMIN', 'MEMBER'] as const;
export type UserRole = (typeof userRoles)[number];

export const registrationModes = ['JOIN_GUILD', 'CREATE_GUILD'] as const;
export type RegistrationMode = (typeof registrationModes)[number];

export interface EquipmentItem {
  val: string;
  color: string;
}

export type Equipment = Record<string, EquipmentItem>;

export interface Skills {
  active: Record<string, string>;
  passive: Record<string, string>;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface RegisterInput {
  mode: RegistrationMode;
  code?: string;
  guild_name?: string;
  username: string;
  password: string;
  nickname: string;
  occupation: string;
  main_class: string;
  combat_power: number;
  equipment: Equipment;
  skills: Skills;
}

export interface CharacterProfileInput {
  occupation: string;
  mainClass: string;
  combatPower: number;
  equipment: Equipment;
  skills: Skills;
}

export interface AuthUser {
  id: number;
  guildId: number;
  username: string;
  passwordHash: string;
  role: UserRole;
  nickname: string;
  isActive: boolean;
}

export interface RegistrationResult {
  userId: number;
  guildId: number;
  role: UserRole;
}

export interface AuthSession {
  token: string;
  userId: number;
  username: string;
  nickname: string;
  role: UserRole;
}
