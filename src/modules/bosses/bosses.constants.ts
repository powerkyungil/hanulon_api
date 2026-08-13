export interface DefaultBossDefinition {
  type: string;
  region: string;
  boss: string;
  cooldownHours: number;
  timeText: string | null;
  days: string | null;
  color: string | null;
}

const cooldowns: Record<string, number> = {
  '4층분노의모네가름': 12,
  스칼라니르: 12,
  니드호그: 12,
  라이노르: 12,
  라타토스크: 12,
  바우티: 12,
  야른: 12,
  브륀힐드: 12,
  비요른: 12,
  셀로비아: 12,
  수드리: 12,
  페티: 12,
  파르바: 12,
  헤르모드: 12,
  흐니르: 12,
  '7층나태의드라우그': 24,
  굴베이그: 24,
  두라스로르: 24,
  드라우그: 24,
  스바르트: 24,
  모네가름: 24,
  우로보로스: 36,
  '10층다인홀로크': 36,
  최하층강글: 36,
  메기르: 36,
  탕그리스니르: 36,
  최하층굴베: 36,
  헤르가름: 36,
  신마라: 36,
  엘드룬: 36,
  발리: 48,
  샤무크: 48,
  스칼드메르: 48,
  노트: 48,
  그로아: 48,
  헤이드: 60,
  호드: 60,
  히로킨: 60,
  수르트: 72,
  오딘: 72,
  최하층스네르: 72,
  토르: 72,
  티르: 72,
  미미르: 72,
  이미르: 120,
};

const regionalBosses: Array<{ type: string; regions: Array<[string, string[]]> }> = [
  {
    type: '공통',
    regions: [
      [
        '던전',
        [
          '4층분노의모네가름',
          '7층나태의드라우그',
          '10층다인홀로크',
          '최하층강글',
          '최하층굴베',
          '최하층스네르',
        ],
      ],
    ],
  },
  ...(['침공', '본섭'] as const).map((type) => ({
    type,
    regions: [
      ['요툰하임', ['파르바', '흐니르', '셀로비아', '니드호그', '바우티', '페티', '야른', '티르']],
      [
        '니다벨리르',
        [
          '라이노르',
          '라타토스크',
          '비요른',
          '헤르모드',
          '스칼라니르',
          '브륀힐드',
          '수드리',
          '토르',
        ],
      ],
      ['알브하임', ['스바르트', '모네가름', '두라스로르', '드라우그', '굴베이그', '오딘']],
      [
        '무스펠',
        ['신마라', '메기르', '헤르가름', '탕그리스니르', '엘드룬', '우로보로스', '수르트'],
      ],
      ['아스가르드', ['발리', '노트', '샤무크', '스칼드메르', '그로아', '미미르']],
      ['니플하임', ['히로킨', '호드', '헤이드', '이미르']],
    ] as Array<[string, string[]]>,
  })),
];

const fixedEvents: Array<[string, string, string]> = [
  ['월드 보스', '12:00:00', '월,화,수,목,금,토,일'],
  ['월드 보스', '20:00:00', '월,화,수,목,금,토,일'],
  ['정예몬스터', '19:00:00', '월,화,수,목,금,토,일'],
  ['니다 닻', '18:30:00', '수'],
  ['알브 닻', '20:30:00', '수'],
  ['성채보스', '21:30:00', '화,목'],
  ['무스펠 닻', '22:30:00', '수'],
  ['지옥성채보스', '22:30:00', '목'],
];

export const DEFAULT_BOSS_DEFINITIONS: DefaultBossDefinition[] = [
  ...regionalBosses.flatMap(({ type, regions }) =>
    regions.flatMap(([region, bosses]) =>
      bosses.map((boss) => ({
        type,
        region,
        boss,
        cooldownHours: cooldowns[boss] ?? 0,
        timeText: null,
        days: null,
        color: null,
      })),
    ),
  ),
  ...fixedEvents.map(([boss, timeText, days]) => ({
    type: '고정',
    region: '공통',
    boss,
    cooldownHours: 0,
    timeText,
    days,
    color: null,
  })),
];
