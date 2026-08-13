export const bossControlCatalog = [
  {
    chapter: '요툰하임',
    bosses: ['파르바', '셀로비아', '흐니르', '페티', '바우티', '니드호그', '야른'],
  },
  {
    chapter: '니다벨리르',
    bosses: ['라이노르', '비요른', '헤르모드', '스칼라니르', '브륀힐드', '라타토스크', '수드리'],
  },
  { chapter: '알브하임', bosses: ['스바르트', '두라스로르', '모네가름', '드라우그', '굴베이그'] },
  {
    chapter: '무스펠하임',
    bosses: ['메기르', '신마라', '헤르가름', '탕그리스니르', '엘드룬', '우로보로스'],
  },
  { chapter: '아스가르드', bosses: ['발리', '노트', '샤무크', '스칼드메르', '그로아'] },
  { chapter: '니플하임', bosses: ['히로킨', '호드', '헤이드', '프레이'] },
  { chapter: '절대자', bosses: ['티르', '토르', '오딘', '수르트', '미미르', '이미르'] },
  {
    chapter: '지하감옥',
    bosses: ['최하층굴베', '최하층강글', '최하층스네르', '4층', '7층', '10층'],
  },
  { chapter: '성채', bosses: ['2층', '3층', '4층', '5층', '6층', '7층', '8층'] },
  { chapter: '지옥성채', bosses: ['1시 보스', '7시 보스', '이미르'] },
  {
    chapter: '로키(필드)',
    bosses: [
      '요툰하임',
      '니다벨리르',
      '알브하임',
      '무스펠하임',
      '아스가르드',
      '니플하임',
      '바나하임',
    ],
  },
  { chapter: '로키(균열)', bosses: ['1단계', '2단계', '3단계', '4단계', '5단계'] },
] as const;

export const isCatalogBoss = (chapter: string, boss: string): boolean =>
  bossControlCatalog.some(
    (catalogChapter) =>
      catalogChapter.chapter === chapter &&
      catalogChapter.bosses.some((catalogBoss) => catalogBoss === boss),
  );
