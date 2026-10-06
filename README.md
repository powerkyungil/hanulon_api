# Odin Guild API

Odin Guild Flutter 앱을 위한 길드 운영 API 서버입니다. 길드원 관리부터 보스 일정·참여·투표, 컬렉션, 공성전, 분배 정산, OCR 일정 분석, Android FCM 알림까지 하나의 Fastify 서버에서 제공합니다.

이 프로젝트는 API 전용 서버입니다. Flutter 앱이나 정적 웹 파일을 제공하지 않으며, Discord와 짱깸보 기능은 현재 범위에 포함하지 않습니다.

상세한 구조·권한·데이터 보존·API 계약은 [`docs/backend-architecture.md`](docs/backend-architecture.md)를 기준으로 합니다.

## 주요 기능

| 영역          | 제공 기능                                                               |
| ------------- | ----------------------------------------------------------------------- |
| 인증·길드     | 로그인, 길드 생성·가입, 초대 코드, 내 정보, 계정 탈퇴                   |
| 회원 관리     | 길드원 목록, 역할 변경, 길드장 위임, 비밀번호 초기화·강퇴               |
| 보스 운영     | 보스 정의, 일정 등록·컷·멍, 참여 대상·참여 현황                         |
| 참여 투표     | 수동·일정 기반 투표, 마감·삭제, 참여 통계·회원별 참여율                 |
| 공지·가격표   | 길드룰, 가격표, 보스 통제 상태                                          |
| 손지원        | 지원 요청, 신청, 지원자 선택·재모집                                     |
| 아이템 현황   | 컬렉션 V2, 보유 상태, 제외 회원, 변경 로그                              |
| 콘텐츠·공성전 | 콘텐츠 그룹 편성, 공성전 다이아 현황                                    |
| 분배 정산     | 기간별 길드원 snapshot, 지원비 차감, 참여·연합분배, 반올림, 확정·재개방 |
| 외부 연동     | CLOVA OCR 일정 분석 proxy, FCM 보스 일정 알림                           |

## 기술 스택

- Node.js LTS (`20.19+`, `22.13+` 또는 `24+`)
- TypeScript strict mode
- Fastify 5
- SQLite + `better-sqlite3`
- TypeBox JSON Schema
- JWT access token + `bcryptjs`
- `decimal.js` 기반 정밀 분배 계산
- Vitest, ESLint, Prettier

별도 SQLite 서버는 필요하지 않습니다. 서버가 `DB_PATH`의 상위 디렉터리를 만들고 SQLite 파일을 엽니다.

## 빠른 시작

### 1. 설치

```bash
npm ci
cp .env.example .env
```

`.env`에서 `JWT_SECRET`을 설정합니다. 개발·테스트 환경에서도 값이 필요하며, 운영 환경에서는 32자 이상의 무작위 문자열을 사용해야 합니다.

### 2. 개발 서버 실행

```bash
npm run dev
```

기본 주소는 `http://127.0.0.1:3001`입니다.

```bash
curl http://127.0.0.1:3001/api/v1/health/live
curl http://127.0.0.1:3001/api/v1/health/ready
curl http://127.0.0.1:3001/api/v1/time
```

`health/live`는 프로세스 생존을, `health/ready`는 SQLite와 migration 준비 상태를 확인합니다.

### 3. 로그인 예시

```bash
curl -X POST http://127.0.0.1:3001/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"사용자명","password":"비밀번호"}'
```

응답의 `data.token`을 이후 요청의 Bearer token으로 사용합니다.

```bash
curl http://127.0.0.1:3001/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

## 환경 변수

`.env.example`이 기본 템플릿입니다. 비밀값은 저장소에 커밋하지 않습니다.

| 변수                          | 기본값                                          | 설명                                                      |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| `NODE_ENV`                    | `development`                                   | `development`, `test`, `production`                       |
| `HOST`                        | `127.0.0.1`                                     | Fastify가 바인딩할 호스트                                 |
| `PORT`                        | `3001`                                          | API 포트                                                  |
| `JWT_SECRET`                  | 없음                                            | JWT 서명 키. 운영 환경은 32자 이상                        |
| `JWT_PREVIOUS_SECRET`         | 없음                                            | JWT 키 교체 기간에만 사용하는 이전 키                     |
| `DB_PATH`                     | `./data/odin-guild.sqlite`                      | SQLite 파일 경로                                          |
| `CORS_ORIGINS`                | 없음                                            | 허용 origin 목록. 여러 개는 쉼표로 구분                   |
| `LOG_LEVEL`                   | `info`                                          | Fastify 로그 레벨                                         |
| `BOSS_HISTORY_RETENTION_DAYS` | `90`                                            | 보스 일정·참여 이력 보존 기간                             |
| `CLOVA_OCR_INVOKE_URL`        | 없음                                            | CLOVA OCR invoke URL. URL과 secret을 함께 설정해야 활성화 |
| `CLOVA_OCR_SECRET`            | 없음                                            | CLOVA OCR 서버 secret                                     |
| `CLOVA_OCR_TEMPLATES`         | `기본 템플릿:123456`                            | `이름:템플릿ID` 형식의 쉼표 구분 목록                     |
| `FCM_SERVICE_ACCOUNT_JSON`    | 없음                                            | Firebase service account JSON 원문                        |
| `FCM_SERVICE_ACCOUNT_FILE`    | `/etc/odin-guild/firebase-service-account.json` | service account JSON 파일 경로                            |
| `FCM_DISPATCH_WINDOW_SECONDS` | `90`                                            | FCM dispatcher가 처리할 시간 창                           |

FCM은 `FCM_SERVICE_ACCOUNT_JSON`을 우선 사용하며, 값이 없으면 `FCM_SERVICE_ACCOUNT_FILE`을 읽습니다. 운영에서는 service account 파일을 저장소 밖에 두고 실행 계정만 읽을 수 있도록 제한합니다.

## API 개요

새 클라이언트는 `/api/v1` 경로를 사용합니다. 인증이 필요한 모든 API는 다음 헤더를 사용합니다.

```http
Authorization: Bearer <access-token>
```

| 영역        | 주요 `/api/v1` 경로                                                                                | 인증        |
| ----------- | -------------------------------------------------------------------------------------------------- | ----------- |
| 상태·시각   | `/health/live`, `/health/ready`, `/time`                                                           | 불필요      |
| 인증·길드   | `/auth/login`, `/auth/register`, `/auth/me`, `/auth/invites`, `/guild/settings`                    | 일부 불필요 |
| 회원        | `/members`, `/members/:id/role`, `/guild/master`                                                   | 필요        |
| 보스·일정   | `/bosses`, `/schedules`, `/participation-targets`, `/participants`, `/participation-states`        | 필요        |
| 투표        | `/boss-votes`, `/vote-stats`, `/vote-member-rates`                                                 | 필요        |
| 공지        | `/notices/rules`, `/notices/price-guides`, `/notices/boss-controls`                                | 필요        |
| 손지원      | `/support-requests`                                                                                | 필요        |
| 컬렉션      | `/collections`, `/collection-completions`, `/collection-exclusions`, `/collection-completion-logs` | 필요        |
| 콘텐츠 그룹 | `/content-groups`                                                                                  | 필요        |
| 공성전      | `/siege`                                                                                           | 필요        |
| 분배        | `/distributions`, `/distributions/alliance-rate-tiers`                                             | 필요        |
| OCR         | `/ocr/templates`, `/ocr/boss-schedule`                                                             | 필요        |
| 푸시 토큰   | `/push-tokens`                                                                                     | 필요        |

### 응답 규칙

정식 v1 성공 응답은 `data` 아래에 결과를 담습니다.

```json
{
  "data": {
    "id": 1,
    "name": "파르바"
  }
}
```

오류는 안정적인 `code`와 요청 추적용 `requestId`를 포함합니다.

```json
{
  "error": {
    "code": "SCHEDULE_NOT_FOUND",
    "message": "보스 일정을 찾을 수 없습니다.",
    "details": null,
    "requestId": "req_01..."
  }
}
```

v1 JSON 필드는 `camelCase`, 데이터베이스 컬럼은 `snake_case`를 사용합니다. 날짜·시각은 기본적으로 Unix epoch milliseconds이며, 달력 기준과 서버 시각은 `Asia/Seoul`입니다.

### 권한

- `MASTER`: 길드 전체 운영과 정산을 관리합니다.
- `ADMIN`: 회원·보스·공지 등 운영 기능을 수행합니다.
- `MEMBER`: 일반 길드원 기능을 사용합니다.

역할과 길드 소속은 JWT claim만 믿지 않고 요청 시점의 데이터베이스 상태를 다시 확인합니다. 모든 도메인 데이터는 현재 사용자의 `guildId` 범위로 격리됩니다.

### Legacy 호환 경로

기존 웹·Flutter 클라이언트 전환을 위해 `/api/login`, `/api/users/...`, `/api/schedules`, `/api/v2/collections` 등의 legacy 경로도 유지합니다. 신규 기능과 신규 클라이언트는 `/api/v1`을 사용해야 하며 legacy 경로를 기준으로 확장하지 않습니다.

## 프로젝트 구조

```text
odin_guild_api/
├── docs/
│   └── backend-architecture.md
├── src/
│   ├── app.ts                 # Fastify 인스턴스·plugin·route 등록
│   ├── server.ts              # 환경 로드·포트 listen·graceful shutdown
│   ├── config/                # 환경 변수와 공통 상수
│   ├── plugins/               # 인증·CORS·오류·request context
│   ├── infrastructure/
│   │   ├── db/                # SQLite client·migration·transaction
│   │   ├── ocr/               # CLOVA OCR client
│   │   └── push/              # FCM HTTP v1 client
│   ├── modules/               # 도메인별 route·schema·service·repository
│   ├── jobs/                  # 보스 일정 FCM dispatcher
│   └── shared/                # 공통 오류·응답·초대 코드
├── test/
│   ├── routes/                # fastify.inject() 기반 route 테스트
│   └── unit/                  # 계산·외부 client 단위 테스트
├── ops/systemd/               # FCM dispatcher service·timer
├── package.json
└── .env.example
```

Route는 HTTP 입출력과 schema·인증 연결만 담당합니다. 업무 규칙은 service, SQL과 row 매핑은 repository에 둡니다. 외부 네트워크 호출은 SQLite transaction 안에서 실행하지 않습니다.

## 데이터베이스와 migration

- SQLite는 foreign key와 WAL 모드로 실행됩니다.
- 서버 시작 시 `src/infrastructure/db/migrations/`의 미적용 SQL을 버전 순서대로 적용합니다.
- 현재 migration은 `000_schema_migrations.sql`부터 `023_distribution_currency_reconciliation.sql`까지입니다.
- 데이터베이스 디렉터리가 없으면 서버가 자동으로 생성합니다.
- 테이블을 코드에서 임의로 생성하거나 기존 migration 파일을 수정하지 말고, 변경마다 새 migration을 추가합니다.
- 로컬 DB 파일과 WAL 파일은 `.gitignore`에 포함되어 있습니다.

분배 정산은 길드원 정보를 기간 생성 시점에 snapshot으로 저장하고, decimal 계산 결과를 문자열로 반환합니다. 초안은 `DRAFT`, 확정된 정산은 `CONFIRMED` 상태로 관리하며 확정 후에는 `MASTER`의 재개방 절차가 필요합니다.

## OCR과 FCM

### CLOVA OCR

`POST /api/v1/ocr/boss-schedule`은 JPEG·PNG 원본을 서버에서 CLOVA OCR로 전달하고 분석 결과만 반환합니다. 원본 이미지는 저장하지 않으며, OCR secret과 template 설정은 서버 환경 변수에만 둡니다.

### 보스 일정 푸시

로그인한 Android 기기는 `PUT /api/v1/push-tokens`로 FCM token을 등록합니다. 별도 dispatcher가 현재 일정과 고정 일정을 계산해 출현 5분 전, 1분 전, 출현 시점에 알림을 보냅니다.

개발 환경에서는 다음 명령으로 한 번 실행할 수 있습니다.

```bash
npm run push:boss:dev
```

운영 빌드에서는 `npm run push:boss`와 `ops/systemd/hanulon-boss-push.service`, `ops/systemd/hanulon-boss-push.timer`를 사용합니다. timer는 약 10초 간격으로 dispatcher를 실행합니다.

## 검증과 빌드

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

개별 명령은 다음과 같습니다.

| 명령                   | 용도                                |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | `tsx watch` 개발 서버               |
| `npm run build`        | TypeScript 컴파일 및 migration 복사 |
| `npm start`            | `dist/server.js` 운영 실행          |
| `npm test`             | 전체 테스트 1회 실행                |
| `npm run test:watch`   | 테스트 watch 모드                   |
| `npm run format:check` | Prettier 검사                       |
| `npm run lint`         | ESLint 검사                         |
| `npm run typecheck`    | TypeScript 타입 검사                |

Route 테스트는 실제 포트를 열지 않고 `fastify.inject()`로 실행합니다.

## 변경 시 참고

백엔드 기능을 추가하거나 수정하기 전 [`docs/backend-architecture.md`](docs/backend-architecture.md)의 module 경계, API 계약, 권한, migration, 테스트 기준을 확인합니다. Flutter API 계약을 바꾸는 경우에는 인접 프로젝트의 `docs/flutter-frontend-architecture.md`도 함께 갱신합니다.

커밋 전에는 최소한 다음 검증을 통과해야 합니다.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
