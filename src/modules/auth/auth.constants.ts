export const classesByOccupation: Readonly<Record<string, readonly string[]>> = {
  워리어: ['디펜더', '버서커', '썬더브링어', '프로스트 본'],
  로그: ['스나이퍼', '어쌔신', '헌트리스'],
  소서리스: ['아크 메이지', '다크 위저드', '인챈트리스', '알케미스트'],
  프리스트: ['세인트', '팔라딘', '바드', '새크리파이스'],
  '실드 메이든': ['발키리', '액슬러', '디스트로이어'],
};

export const equipmentParts = [
  '무기',
  '보조무기',
  '투구',
  '갑옷',
  '장갑',
  '각반',
  '신발',
  '망토',
  '목걸이',
  '귀걸이',
  '팔찌',
  '반지',
  '벨트',
] as const;

export const equipmentGrades = ['none', 'hero', 'legend', 'mythic'] as const;

export const skillNames = ['영웅 1', '영웅 2', '영웅 3', '영웅 4', '전설 1', '전설 2'] as const;

export const skillLevels = [
  'X',
  '0강',
  '1강',
  '2강',
  '3강',
  '4강',
  '5강',
  '6강',
  '7강',
  '8강',
  '9강',
  '10강',
] as const;

export const allMainClasses = Object.values(classesByOccupation).flat();

export const isValidClassCombination = (occupation: string, mainClass: string): boolean =>
  classesByOccupation[occupation]?.includes(mainClass) ?? false;

export const isValidMainClass = (mainClass: string): boolean => allMainClasses.includes(mainClass);
