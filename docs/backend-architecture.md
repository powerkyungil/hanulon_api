# Odin Guild API 백엔드 아키텍처

> 상태: 기준안
>
> 기준일: 2026-08-10
>
> 기준 프로젝트: `odin_boss_schedule`
>
> 클라이언트: `/Applications/XAMPP/xamppfiles/htdocs/my-prj/odin_guild_app`

## 1. 문서 목적

이 문서는 Odin Guild 앱의 Fastify 백엔드에서 지켜야 할 구조, API 계약, 데이터 저장, 보안, 운영, 테스트 기준을 정의한다.

새 기능을 추가하거나 기존 기능을 수정할 때 이 문서를 먼저 확인한다. 구현과 문서가 달라지는 경우에는 구현만 끝내지 말고 이 문서의 해당 절을 함께 갱신한다.

## 2. 기술 선택

| 영역            | 결정                                                   | 이유                                                                                                                                                                    |
| --------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 런타임          | Node.js LTS                                            | Flutter 앱과 분리된 API 서버를 구성하고 기존 Node 생태계와 연동하기 쉽다.                                                                                               |
| 언어            | TypeScript                                             | 일정·투표·컬렉션처럼 DTO와 권한이 많은 도메인의 필드 오류를 줄인다. 빌드 후 운영 런타임에는 JavaScript만 배포한다.                                                      |
| HTTP 프레임워크 | Fastify v5                                             | 낮은 오버헤드, schema 기반 검증·직렬화, plugin 구조를 사용한다.                                                                                                         |
| API 계약        | TypeBox schema + 아키텍처 문서 + route/contract test   | 별도 문서 UI 없이 코드의 schema와 테스트를 API 계약의 기준으로 사용한다.                                                                                                |
| 인증            | JWT access token + bcrypt 계열 해시                    | 현재 앱의 인증 흐름을 유지하되 서버에서 역할과 만료를 검증한다.                                                                                                         |
| 데이터베이스    | SQLite                                                 | Naver Cloud Micro의 단일 서버·소규모 길드 운영에 적합하다.                                                                                                              |
| DB 접근         | SQL Repository + `better-sqlite3` + prepared statement | JPA/Hibernate 같은 무거운 ORM을 사용하지 않고 쿼리와 transaction 경계를 명확히 한다. 짧은 SQLite 작업만 동기 실행하고 외부 네트워크 호출은 transaction 밖에서 처리한다. |
| 외부 OCR        | 서버의 `fetch` 기반 CLOVA OCR client                   | OCR secret과 template 설정을 Flutter에 노출하지 않는다.                                                                                                                 |
| 프로세스        | 단일 Fastify process                                   | SQLite 파일 잠금과 Micro 자원 제한을 고려한다. cluster/PM2 cluster는 사용하지 않는다.                                                                                   |

Fastify의 공식 문서와 plugin 목록은 [Fastify 공식 사이트](https://fastify.dev/)와 [Ecosystem](https://fastify.dev/docs/latest/Guides/Ecosystem/)을 기준으로 확인한다. 주요 패키지의 버전은 설치 시점의 호환 가능한 최신 버전을 사용하되, major 버전 변경은 이 문서의 기술 선택 절을 갱신한다.

## 3. 범위

### 3.1 포함

- 로그인, 초대 가입, 내 정보, 역할 관리
- 길드원·길드 설정
- 보스 정의와 보스 일정
- 보스 참여 대상과 참여 현황
- 보스 참여 투표, 마감·삭제, 기간별 통계
- 공지·가격표·보스 통제
- 손지원 요청·신청·매칭
- 컬렉션 V2
- 콘텐츠 그룹
- 공성전 현황
- CLOVA OCR 일정 분석 proxy
- 보스 참여 이력의 날짜별 보존과 자동 정리

### 3.2 제외

- Flutter 화면과 정적 웹 파일 제공
- Discord bot 및 Discord 알림
- 짱깸보 기능
- 클라이언트의 DB 직접 접근
- 초기 단계의 WebSocket/SSE 실시간 동기화

실시간 동기화가 필요해지면 먼저 polling으로 해결 가능한지 확인하고, SSE/WebSocket 도입 비용과 Micro 서버 부하를 문서의 결정 로그에 기록한다.

## 4. 전체 구조

```mermaid
flowchart LR
    Client["Flutter App"] --> HTTPS["HTTPS /api/v1"]
    HTTPS --> Fastify["Fastify API\nTypeScript → JavaScript"]
    Fastify --> Auth["Auth Plugin\nJWT / Role"]
    Fastify --> Modules["Feature Modules\nRoutes / Services / Repositories"]
    Modules --> SQLite[("SQLite")]
    Modules --> OCR["CLOVA OCR"]
    Fastify --> Logs["Pino Logs / Health"]
```

### 4.1 실행 경계

- `src/app.ts`: Fastify instance를 만들고 plugin·route를 등록한다. `listen`하지 않는다.
- `src/server.ts`: 환경을 로드하고 `app.ts`를 생성한 뒤 실제 포트를 열고 graceful shutdown을 처리한다.
- 테스트는 `src/app.ts`를 import하여 실제 포트를 열지 않고 `fastify.inject()`로 실행한다.
- API 서버는 Flutter 앱만 대상으로 하며 `@fastify/static`을 사용하지 않는다.
- TLS 종료와 public `80/443` 처리는 Nginx 또는 Naver Cloud의 HTTPS 계층에서 담당한다.

### 4.2 요청 흐름

```text
HTTP 요청
  → request-id / logger
  → CORS / body limit
  → JWT 인증
  → role/permission hook
  → route schema 검증
  → service/use case
  → repository transaction
  → response DTO 직렬화
  → 공통 에러·로그 처리
```

Route handler에서 SQL을 실행하거나 외부 OCR을 직접 호출하지 않는다.

## 5. 디렉터리 구조

```text
odin_guild_api/
├── AGENTS.md
├── docs/
│   └── backend-architecture.md
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── server.ts
│   ├── app.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── constants.ts
│   ├── plugins/
│   │   ├── auth.plugin.ts
│   │   ├── cors.plugin.ts
│   │   ├── error.plugin.ts
│   │   └── request-context.plugin.ts
│   ├── shared/
│   │   ├── errors/
│   │   ├── http/
│   │   ├── permissions/
│   │   ├── time/
│   │   └── validation/
│   ├── infrastructure/
│   │   ├── db/
│   │   │   ├── client.ts
│   │   │   ├── migrations/
│   │   │   └── transaction.ts
│   │   └── external/
│   │       └── clova-ocr.client.ts
│   └── modules/
│       ├── auth/
│       ├── deputy-accounts/
│       ├── guild/
│       ├── members/
│       ├── bosses/
│       ├── schedules/
│       ├── boss-votes/
│       ├── notices/
│       ├── support/
│       ├── collections/
│       ├── content-groups/
│       ├── siege/
│       ├── distributions/
│       ├── push-notifications/
│       └── ocr/
├── test/
│   ├── unit/
│   ├── routes/
│   ├── integration/
│   └── fixtures/
└── ops/
    ├── systemd/
    ├── nginx/
    └── backup/
```

각 module은 다음 구조를 기본으로 한다.

```text
modules/schedules/
├── schedules.route.ts       # URL, auth 연결, request/reply 변환
├── schedules.schema.ts      # TypeBox/JSON Schema
├── schedules.service.ts     # 업무 규칙과 transaction 조합
├── schedules.repository.ts  # SQL, row mapping
├── schedules.types.ts       # domain/type
└── index.ts                 # module registration
```

### 5.1 계층별 규칙

| 계층           | 책임                                            | 금지 사항                  |
| -------------- | ----------------------------------------------- | -------------------------- |
| route          | HTTP 입출력, schema, 인증 hook 연결             | SQL, 복잡한 업무 규칙      |
| schema         | 입력·출력 형식, 길이·범위 검증                  | DB 조회로 권한 판단        |
| service        | 업무 규칙, 권한 조건, transaction orchestration | HTTP 객체 의존             |
| repository     | SQL, prepared statement, row↔domain 변환        | HTTP status 결정           |
| infrastructure | DB·OCR·파일·시계 같은 외부 자원                 | 도메인 정책 결정           |
| domain/types   | 상태 전이, 값 객체, 불변 규칙                   | Fastify request/reply 의존 |

## 6. 모듈 경계

| Module               | 책임                                  | 주요 데이터                                               |
| -------------------- | ------------------------------------- | --------------------------------------------------------- |
| `auth`               | 로그인, 가입, JWT, 초대 token         | users, invites                                            |
| `deputy-accounts`    | 길드 공용 부주 계정, 대상 캐릭터 선택, 기능 제한 | deputy_accounts, deputy_account_audit_logs                |
| `guild`              | 길드명, 운영 정책, 서버 시간          | guild_settings                                            |
| `members`            | 길드원 목록, 역할, 프로필             | users, characters                                         |
| `bosses`             | 보스 정의와 순서                      | custom_bosses                                             |
| `schedules`          | 현재 일정, 컷·멍, 일정 입력           | boss_schedules, schedule_history                          |
| `boss-votes`         | 투표 이벤트, 참여자, 마감·삭제, 통계  | vote_events, vote_participants, vote_states, vote_history |
| `notices`            | 규칙, 가격표, 보스 통제               | notice_rules, price_guides, price_items, boss_controls    |
| `support`            | 손지원 요청·신청·매칭                 | support_requests, support_applications                    |
| `collections`        | 컬렉션 정의와 V2 체크 상태            | collection_items, user_collections, excluded_members      |
| `content-groups`     | 콘텐츠 그룹과 배치                    | content_groups, group_members                             |
| `siege`              | 공성전 참여와 다이아                  | siege_records                                             |
| `distributions`      | 길드 분배 기간·길드원 스냅샷·정산     | distribution_periods, distribution_members                |
| `ocr`                | OCR template 조회·이미지 분석 proxy   | 외부 API 결과, 파일 미저장                                |
| `push-notifications` | 로그인 기기 토큰과 보스 일정 FCM 발송 | push_device_tokens, push_delivery_history                 |

모듈 사이에서 repository를 직접 호출하지 않는다. 다른 모듈의 데이터가 필요하면 해당 모듈이 제공하는 service/query interface를 호출하고, 순환 의존성이 생기면 공통 query 또는 별도 application service로 분리한다.

## 7. API 계약

### 7.1 경로와 명명

- 모든 신규 endpoint는 `/api/v1` prefix를 사용한다.
- 리소스는 복수형 명사를 사용한다. 예: `/api/v1/schedules`.
- 명령형 동작은 리소스 하위 action으로 제한한다. 예: `/api/v1/schedules/:id/cut`.
- DB 컬럼은 `snake_case`, JSON 필드는 `camelCase`를 사용한다.
- 시간은 저장·전송 모두 Unix epoch milliseconds를 기본으로 한다. 사람이 읽는 날짜는 클라이언트에서 Asia/Seoul로 표시한다.
- ID는 숫자라도 JSON 계약에서는 string으로 바꾸지 않고 실제 타입을 문서에 고정한다. `voteKey`처럼 복합 식별자는 string으로 둔다.

### 7.2 기본 응답

성공 응답은 가능한 한 `data` 아래에 결과를 넣는다.

```json
{
  "data": {
    "id": 1,
    "name": "파르바"
  }
}
```

목록 응답은 pagination을 확장할 수 있는 형태로 만든다.

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 50,
    "total": 0
  }
}
```

### 7.3 오류 응답

모든 오류는 안정적인 `code`를 갖는다.

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

권장 상태 코드:

| 상태  | 용도                            |
| ----- | ------------------------------- |
| `400` | JSON 형식·입력값 오류           |
| `401` | token 없음·만료·위조            |
| `403` | 역할·정책상 권한 부족           |
| `404` | 리소스 없음                     |
| `409` | 중복·상태 충돌                  |
| `422` | 형식은 맞지만 업무 규칙 위반    |
| `429` | 로그인·OCR 등 rate limit 초과   |
| `500` | 예상하지 못한 서버 오류         |
| `503` | DB·외부 OCR 등 의존성 사용 불가 |

내부 stack trace와 secret은 응답하지 않는다. 실제 오류는 requestId로 로그에서 추적한다.

기존 웹의 compatibility route는 전환 기간에 `code`, `message`, `details`, `requestId`와 함께 기존 화면이 읽는 `error` 문자열을 같은 메시지로 반환한다.

### 7.4 초기 route 영역

```text
/api/v1/health/live
/api/v1/health/ready
/api/v1/time
/api/v1/auth/login
/api/v1/auth/register
/api/v1/auth/me
/api/v1/auth/invites
/api/v1/deputy-auth/login
/api/v1/deputy-accounts
/api/v1/deputy-accounts/:id/password
/api/v1/deputy-accounts/:id/active
/api/v1/deputy/me
/api/v1/deputy/characters
/api/v1/deputy/active-character
/api/v1/guild/settings
/api/v1/guild/master
/api/v1/members
/api/v1/members/:id/role
/api/v1/members/:id/password-reset
/api/v1/members/:id
/api/v1/bosses
/api/v1/bosses/:id
/api/v1/bosses/order
/api/v1/bosses/reset
/api/v1/schedules
/api/v1/schedules/:id
/api/v1/schedules/cut
/api/v1/schedules/mung
/api/v1/participation-targets
/api/v1/participants
/api/v1/participants/:boss
/api/v1/participation-states
/api/v1/boss-votes
/api/v1/boss-votes/:voteKey
/api/v1/boss-votes/manual
/api/v1/boss-votes/:voteKey/participation
/api/v1/vote-stats
/api/v1/vote-member-rates
/api/v1/notices/rules
/api/v1/notices/rules/:id
/api/v1/notices/rules/order
/api/v1/notices/price-guides
/api/v1/notices/price-guides/:id
/api/v1/notices/boss-controls
/api/v1/support-requests
/api/v1/support-requests/:id/status
/api/v1/support-requests/:id/applications
/api/v1/support-requests/:requestId/applications/:applicationId
/api/v1/support-requests/:requestId/select/:applicationId
/api/v1/collections
/api/v1/collections/:id
/api/v1/collection-completions
/api/v1/collection-completion-logs
/api/v1/collection-exclusions
/api/v1/collection-exclusions/toggle
/api/v1/content-groups
/api/v1/content-groups/roster
/api/v1/content-groups/:id
/api/v1/content-groups/:id/members
/api/v1/siege
/api/v1/siege/me
/api/v1/siege/members/:id
/api/v1/distributions
/api/v1/distributions/alliance-rate-tiers
/api/v1/distributions/:id
/api/v1/distributions/:id/members/:memberId
/api/v1/distributions/:id/members
/api/v1/distributions/:id/calculate
/api/v1/distributions/:id/confirm
/api/v1/distributions/:id/reopen
/api/v1/ocr/templates
/api/v1/ocr/boss-schedule
/api/v1/push-tokens
```

기존 웹 API와 이름이 달라지는 endpoint는 Flutter repository에서 adapter를 두거나, 초기 migration 기간에 compatibility route를 별도로 둔다. 새 코드가 legacy 경로를 기준으로 확장되지는 않게 한다.

길드원 관리 API의 권한과 상태 변경은 다음을 기준으로 한다.

- 길드원 목록은 로그인한 사용자의 `guildId` 범위에 속한 활성 사용자만 반환한다.
- 역할 변경·길드장 위임·강퇴는 `MASTER`만 수행한다.
- 비밀번호 초기화는 `MASTER`와 `ADMIN`이 수행할 수 있지만 `ADMIN`은 `MASTER`를 초기화할 수 없다.
- 비밀번호 초기화 값은 현재 Flutter 안내와 호환되는 `1234`이며, 사용자는 로그인 후 6자 이상의 새 비밀번호로 변경한다.
- 길드장 위임은 기존 `MASTER → MEMBER`, 대상 `MEMBER/ADMIN → MASTER`를 하나의 transaction에서 처리한다.
- 역할·권한 판단은 JWT claim만 사용하지 않고 요청 시점의 DB 사용자 상태를 다시 확인한다.
- 역할 변경·위임·비밀번호 초기화·강퇴는 `member_audit_logs`에 기록한다.
- 본인 계정 탈퇴는 `DELETE /api/v1/auth/me`에 `{ "password": "현재 비밀번호" }`를 보내며, 현재 Flutter 호환 경로인 `DELETE /api/users/me`도 동일한 정책으로 제공한다.
- 탈퇴 요청은 현재 비밀번호를 bcrypt로 다시 검증한다. 불일치는 `ACCOUNT_DELETE_PASSWORD_INVALID`(401)로 거절한다. 다른 사용자가 한 명이라도 있는 길드의 `MASTER`는 `MASTER_ACCOUNT_DELETE_FORBIDDEN`(409)으로 위임을 요구한다.
- 일반 회원 탈퇴는 현재 인증 사용자의 `id`와 DB의 `guildId`를 함께 제한해 hard delete하며 길드와 다른 길드원의 공유 데이터는 삭제하지 않는다. 유일한 회원인 `MASTER`는 계정과 길드 전체를 한 transaction에서 hard delete할 수 있다. 삭제된 사용자 행을 인증 시 다시 조회할 수 없으므로 기존 JWT도 즉시 401 처리된다.

마스터 설정과 가입 코드 API는 다음 정책을 사용한다.

- 길드 설정 조회는 활성 길드원 모두 가능하며, 수정은 `MASTER`만 수행한다.
- 길드명 변경 시 대소문자를 구분하지 않고 전체 길드에서 중복을 검사한다.
- 전투력 수정 허용 여부는 `guild_settings.allow_member_combat_power_edit`에 저장한다.
- 가입 코드는 `MASTER`만 조회·발급하며 길드와 대상 역할별로 하나만 유지한다.
- 길드 생성 transaction에서 6자리 대문자 영문·숫자 MEMBER 기본 가입 코드를 함께 발급한다. DB 전역 unique 제약과 최대 100회 충돌 재생성으로 다른 길드 코드와 겹치지 않게 한다.
- 길드 생성 회원가입 응답은 `inviteCode`에 생성된 MEMBER 기본 코드를 포함해 클라이언트가 가입 완료 화면에 즉시 표시할 수 있게 한다. 기존 길드 가입 응답에는 이 필드가 없다.
- 기존 길드 중 MEMBER 코드가 없는 길드는 서버 시작 시 같은 생성·충돌 재시도 규칙으로 길드별 코드를 채운다.
- 새 가입 코드를 발급하면 같은 역할의 기존 코드는 즉시 사용할 수 없게 된다.
- 사용자 지정 코드는 4~32자의 영문자·숫자·`_`·`-`만 허용하고 서버에서 대문자로 정규화한다.
- legacy 설정 요청의 Discord 필드는 호환 목적으로 입력만 허용하며 저장·응답·로그에서 제외한다.
- 설정 변경과 가입 코드 교체는 비밀값 없이 `guild_audit_logs`에 기록한다.

보스 정의·일정·참여 API는 다음 정책을 사용한다.

- 모든 활성 길드원은 같은 길드의 보스 정의, 현재 일정, 참여 대상·참여자·마감 상태를 조회할 수 있다.
- 기존 웹 운영 방식과 동일하게 모든 활성 길드원은 일정 등록·컷·멍·개별 삭제를 수행할 수 있다.
- 보스 정의 등록·삭제·정렬·초기화와 일정 전체 초기화, 참여 대상 변경은 `MASTER`와 `ADMIN`만 수행한다.
- 역할은 JWT claim만 신뢰하지 않고 요청 시점의 DB 사용자 역할과 활성 상태를 다시 확인한다.
- 기본 보스 정의는 길드별 최초 접근 시 한 번만 생성하며 이후 사용자가 전부 삭제해도 자동 재생성하지 않는다.
- 일정 일괄 등록은 같은 보스 정의의 현재 일정을 교체하고 동일 요청 재시도 시 현재 일정과 이력이 중복되지 않는다.
- 고정 일정은 Flutter가 보스 정의와 서버 시각으로 생성하므로 `boss_schedules`에 저장하지 않는다.
- 컷은 서버 현재 시각에 서버 보스 정의의 쿨타임을 더하고, 멍은 요청 시각이 DB의 현재 일정과 일치할 때만 그 시각에 쿨타임을 더한다.
- 일정 occurrence 스냅샷과 해당 투표 이벤트는 `schedule_history`에 보존한다. 일정 시간 변경은 기존 occurrence의 `voteKey`, 참여자, 마감 상태를 이동하거나 숨기지 않고 새 출현 시각에 별도 occurrence를 만든다. 같은 시각 재등록은 기존 occurrence를 재사용하며 컷·멍도 이전 투표를 유지한다.
- 개별 일정 삭제·전체 초기화는 `boss_schedules`의 현재 일정 row만 삭제한다. `schedule_history`, voteKey, 참여자, 투표 상태는 유지하므로 목록·통계·참여율에서 계속 조회할 수 있다. 보스 정의 초기화도 이력과 참여 대상 설정을 삭제하지 않는다.
- `participation_targets`는 보스 정의 ID가 아니라 `(guild_id, type, region, boss)` 식별 키로 저장한다. API는 현재 보스 정의 ID를 계속 반환하며 보스 정의 초기화 후에도 같은 식별 키에 대응하는 투표 대상을 조회한다.
- 일정 row·투표 상태·참여자와 감사 기록 변경은 하나의 동기 transaction으로 반영한다. 일정 감사 로그는 일정 삭제·초기화를 기록하고, 투표 직접 삭제 감사 로그는 선택한 정확한 voteKey를 기록한다.
- 참여 토글은 참여 대상으로 지정된 실제 일정 occurrence만 허용하고 `(guild_id, vote_key, user_id, character_type)`로 중복을 방지한다.
- 일정과 보스 정의·참여 데이터는 모두 현재 `guildId`로 격리하며 전체 초기화도 다른 길드에 영향을 주지 않는다.
- 보스·일정 mutation은 각각 `boss_audit_logs`, `schedule_audit_logs`에 기록한다.
- Flutter의 기존 `/api/schedules`, `/api/custom-bosses`, `/api/participation-*`, `/api/participants` 경로는 compatibility route로 제공한다.

FCM 푸시 API와 보스 일정 알림은 다음 정책을 사용한다.

- 활성 로그인 사용자는 `PUT /api/v1/push-tokens`로 Android FCM 토큰을 등록하거나 갱신하고 `DELETE /api/v1/push-tokens`로 본인 토큰을 삭제한다.
- 동일 FCM 토큰은 서버 전체에서 한 사용자에게만 속한다. 동일 기기의 토큰이 refresh되면 `(user_id, device_id)` 기준 기존 토큰을 새 토큰으로 교체하고, 다른 계정 로그인 시 토큰 소유권을 현재 사용자로 이전한다.
- cron은 현재 `boss_schedules`와 서울 시간 기준 요일·시각으로 계산한 고정 일정의 출현 5분 전, 1분 전, 출현 시점에 해당 길드의 모든 활성 사용자 기기로 FCM HTTP v1 메시지를 발송한다.
- `(guild_id, boss_definition_id, spawn_time, lead_seconds, device_key)` 고유 키와 `PROCESSING/SENT/FAILED` 발송 이력으로 cron 중복 실행, 토큰 refresh와 일정 row 교체에 따른 중복 발송을 차단한다.
- 외부 FCM 호출은 SQLite transaction 밖에서 실행한다. claim lease가 만료된 작업과 일시 실패만 재시도하며 `UNREGISTERED` 토큰은 자동 삭제한다.
- 서비스 계정 JSON은 `FCM_SERVICE_ACCOUNT_JSON` 또는 저장소 밖 `FCM_SERVICE_ACCOUNT_FILE`로만 주입한다. 키 원문·FCM 토큰·Authorization header는 응답과 로그에 남기지 않는다.

보스 참여투표 API는 다음 정책을 사용한다.

- 모든 활성 길드원은 전날부터 다음 날까지의 참여 대상 일정·일정 이력·고정 일정·수동 투표를 출현 시각순으로 조회할 수 있다.
- 일정 기반 투표는 `participation_targets`에 등록된 보스 정의 ID만 포함하고 현재 일정과 `schedule_history`의 동일 occurrence는 중복 반환하지 않는다.
- 수동 투표 등록은 `MASTER`와 `ADMIN`만 가능하며 서울 기준 오늘 또는 내일 시각만 허용한다.
- 동일 길드의 유형·지역·보스·출현 시각이 같은 수동 투표는 unique constraint로 중복 등록을 막는다.
- 투표 참여는 활성 길드원 모두 토글할 수 있고 `(guild_id, vote_key, user_id)` 기본키와 transaction으로 중복을 방지한다.
- 요청의 `voteKey`, 보스명, 출현 시각은 서버가 구성한 실제 투표 occurrence와 모두 일치해야 한다.
- `INACTIVE` 투표는 목록에 마감 상태로 반환하고 참여를 차단하며 `DELETED` 투표는 목록에서 제외한다.
- `DELETE /api/v1/boss-votes/:voteKey`는 `MASTER`와 `ADMIN`만 호출할 수 있다. 일정 투표는 `type|region|boss|spawnTime`, 수동 투표는 `manual|<id>`인 정확한 voteKey로 식별한다. 요청 body는 없고 성공은 `204 No Content`, 존재하지 않거나 다른 길드의 투표는 `BOSS_VOTE_NOT_FOUND`(404), 권한 부족은 `FORBIDDEN`(403)이다.
- 직접 삭제는 해당 voteKey의 참여 행만 삭제하고 투표 삭제 이력을 남긴다. 일정 투표는 현재 일정 또는 고정 일정에서 다시 노출되지 않도록 해당 voteKey를 `DELETED` 상태로 남기며, 다른 voteKey와 일정 row에는 영향을 주지 않는다. 수동 투표는 정확한 수동 이벤트 row와 연결 참여·상태를 삭제한다.
- 참여자는 소유 회원 ID와 캐릭터 종류, 캐릭터명 스냅샷으로 저장한다. 행위자 계정 종류·ID·닉네임도 기록해 타인의 캐릭터를 대신 투표한 사람을 목록에서 식별할 수 있게 한다. 현재 로그인 사용자의 `joined`는 본인 또는 부주의 선택 캐릭터 키로 계산한다.
- `GET /api/v1/boss-votes`는 선택적 `characterKey` query를 받아 해당 캐릭터의 `joined` 상태를 계산한다. 참여 mutation의 body에도 같은 키를 사용할 수 있으며 부주는 토큰에 설정된 캐릭터 키만 사용할 수 있다.
- 수동 투표 등록과 참여 토글은 `boss_vote_audit_logs`에 기록하며 모든 조회·변경은 현재 `guildId`로 격리한다.
- Flutter의 `/api/vote-bosses`, `/api/vote-bosses/manual`, `/api/vote-participants/:voteKey`는 compatibility route로 제공한다.
- 운영진은 투표를 `INACTIVE`로 마감하고 참여자를 수동 제외할 수 있다. 기존 legacy `DELETE /api/vote-bosses/:voteKey`는 마감 API이며 body와 `{ success: true, state: "INACTIVE" }` 응답을 유지한다. 수동 투표의 legacy `DELETE /api/vote-bosses/manual/:id`도 기존 응답을 유지한다.
- 월별 투표 참여 현황과 날짜 범위별 회원 참여율을 제공하고, 마감·삭제된 투표는 통계에서 제외한다.
- 기존 웹의 `/api/vote-bosses/:voteKey`, `/api/vote-bosses/manual/:id`, `/api/vote-participants/:voteKey/users/:userId`, `/api/vote-stats`, `/api/vote-member-rates`는 compatibility route로 제공한다.

부주 계정과 캐릭터 대리 참여는 다음 정책을 사용한다.

- 부주 계정은 길드 단위로 생성하며 로그인 아이디는 일반 사용자 계정과 전역에서 중복될 수 없다. 부주 계정은 특정 캐릭터에 종속되지 않는다.
- `POST /api/v1/deputy-auth/login`은 부주 전용 access token을 발급한다. `GET /api/v1/deputy/characters`에서 같은 길드의 활성 본캐·부캐를 확인하고 `PUT /api/v1/deputy/active-character`로 현재 행동 캐릭터를 선택한다.
- `GET /api/v1/deputy/me`는 본인 부주 계정 프로필을 조회하며, `PUT /api/v1/deputy/me`의 `{ "nickname": "새 닉네임" }`으로 본인 닉네임만 변경한다. 캐릭터 선택 전에도 사용할 수 있고, 응답은 갱신된 프로필을 반환한다.
- 운영진 API는 `GET/POST /api/v1/deputy-accounts`, `PUT /api/v1/deputy-accounts/:id/password`, `PUT /api/v1/deputy-accounts/:id/active`다. 계정 비활성화와 비밀번호 변경은 기존 세션을 무효화한다.
- 부주 접근 범위는 일정 조회·참여(보스 정의 `GET /api/v1/bosses` 포함), 보스 투표 조회·참여, 손지원 요청·신청·매칭, 콘텐츠 그룹 조회로 한정한다. 일정·투표 설정/삭제/마감/통계 관리, 운영 메뉴, 콘텐츠 그룹 편성 변경은 금지한다.
- 부주의 일정·투표 참여는 선택된 캐릭터의 소유 회원과 캐릭터 종류를 기록하며 행위자는 부주 계정으로 남긴다. 기능 사용 전 유효한 캐릭터 선택이 필요하다.
- 일반 길드원은 별도 위임 등록 없이 같은 길드의 캐릭터를 대상으로 참여할 수 있다. 요청에서 `characterKey`를 생략하면 본캐이며, 지정 시 서버가 같은 길드의 활성 캐릭터인지 확인한다.
- 투표 응답은 본인 계정이 아닌 사람이 참여를 등록한 경우 `votedBy`에 행위자 종류·ID·닉네임을 포함한다. 보스 참여 row와 감사 로그는 캐릭터 소유자와 실제 행위자를 따로 보존한다.
- 손지원 요청·신청은 캐릭터 종류와 행위자 부주 ID를 보존한다. 부주는 자신이 선택한 캐릭터의 요청·신청에 대해서만 소유자 작업을 할 수 있고, 운영진 권한은 승계하지 않는다.
- 콘텐츠 그룹은 현재 일반 길드원과 같은 조회 전용 범위다. 편성 및 그룹 관리 mutation은 기존 `MASTER`·`ADMIN` 정책을 유지한다.

부주 계정 데이터는 다음을 기준으로 한다.

- `deputy_accounts`는 길드, 로그인 아이디, bcrypt 비밀번호 해시, 활성 상태, 선택 캐릭터 키, token version을 저장한다. 계정 비밀번호 원문은 저장하지 않는다.
- `deputy_account_audit_logs`는 운영진의 계정 생성·비밀번호 변경·활성 상태 변경과 부주의 캐릭터 선택·닉네임 변경을 행위자 사용자 또는 부주 계정으로 기록한다.
- `boss_participants`의 기본키는 `(guild_id, vote_key, user_id, character_type)`이며 기존 참여 데이터는 본캐·본인 행위자로 migration한다.
- `boss_vote_audit_logs`, `schedule_audit_logs`, `support_audit_logs`, `support_requests`, `support_applications`는 필요한 행위자 부주 ID를 별도로 보존한다.

공지·가격표·보스 통제 API는 다음 정책을 사용한다.

- 길드룰·가격표·보스 통제 조회는 모든 활성 길드원이 수행할 수 있다.
- 등록·수정·삭제·길드룰 순서 변경·보스 통제 변경은 `MASTER`와 `ADMIN`만 수행한다.
- 모든 조회·변경은 인증 사용자의 현재 DB `guildId` 범위로 제한하고 JWT의 오래된 역할 claim만 신뢰하지 않는다.
- 길드룰 순서 변경은 해당 길드의 현재 길드룰 ID 전체를 중복 없이 전달해야 하며 하나라도 누락되거나 다른 길드 ID가 포함되면 거절한다.
- 공지 색상은 `#RRGGBB`, 제목은 100자, 본문은 20,000자 이내로 검증하고 legacy 본문의 `>`·줄바꿈 escape 문자열은 그대로 보존한다.
- 보스 통제 상태는 `NONE`, `ALLY_ONLY`, `CONTROL`만 허용하며 서버의 고정 챕터·보스 목록에 포함된 대상만 변경한다.
- 공지 CRUD·순서 변경·보스 통제 변경은 `notice_audit_logs`에 기록한다.
- Flutter의 기존 `/api/notices/...` 경로는 compatibility route로 제공하고 `/api/v1/notices/...`를 정식 계약으로 사용한다.

손지원 API는 다음 정책을 사용한다.

- 모든 활성 길드원은 같은 길드의 요청 목록 조회·요청 등록·타인 요청 신청을 수행할 수 있다.
- 요청 상태 변경·지원자 선택·요청 삭제는 요청자 또는 `MASTER`·`ADMIN`이 수행한다.
- 신청 취소는 신청자 본인 또는 `MASTER`·`ADMIN`이 수행한다.
- 본인 요청, 중복 신청, `OPEN`이 아닌 요청에 대한 신규 신청은 거절한다.
- `MATCHED`는 상태 변경 API에서 직접 지정하지 않고 지원자 선택을 통해서만 전이한다.
- 지원자 선택은 `OPEN` 또는 `MATCHED` 요청에만 가능하고 요청당 `SELECTED` 신청은 하나만 유지한다.
- 재모집(`OPEN`) 시 기존 신청은 보존하되 선택 지원자와 `SELECTED` 상태를 해제한다.
- 선택된 신청이 취소되면 요청은 자동으로 `OPEN`으로 돌아가고 다시 모집할 수 있다.
- 요청 시간은 1~80자, 요청·신청 메모는 최대 500자로 검증하며 로그인 계정·비밀번호는 저장하거나 반환하지 않는다.
- 모든 조회·변경은 현재 DB `guildId` 범위로 제한하고 mutation은 `support_audit_logs`에 기록한다.
- Flutter의 기존 `/api/support-requests/...` 경로는 compatibility route로 제공한다.

아이템 현황 API는 다음 정책을 사용한다.

- 컬렉션·보유 상태·우선순위 제외 목록은 모든 활성 길드원이 조회할 수 있다.
- 컬렉션 정의 등록·수정·삭제와 우선순위 제외 변경은 `MASTER`와 `ADMIN`이 수행한다.
- 보유 상태는 본인이 변경할 수 있고, 타인의 상태 변경은 `MASTER`만 수행한다.
- 컬렉션 수정 시 전달한 기존 `collectionItemId`는 해당 컬렉션 소속인지 검증하고 그대로 유지한다.
- 요청에서 빠진 기존 item은 삭제하며 연결된 보유 상태도 foreign key cascade로 함께 삭제한다.
- item 배열의 순서를 `sort_order`로 저장하고 순서 변경·신규 item 추가·삭제를 한 transaction에서 처리한다.
- 컬렉션 이름은 길드 안에서 대소문자를 구분하지 않고 중복을 금지한다.
- 컬렉션 이름·item 부위·강화 상태는 각각 최대 100자이며 컬렉션에는 item이 하나 이상 있어야 한다.
- 보유 상태와 제외 대상은 같은 길드의 활성 사용자와 같은 길드의 item만 허용한다.
- 모든 mutation은 `collection_audit_logs`에 기록한다.
- 보유 상태 변경 로그는 대상 `collection_item_id`를 외래키로 저장하고 대상 item 삭제 시 함께 삭제한다.
- 보유 상태 변경 로그 조회는 `MASTER`와 로그인 아이디가 `움매`인 활성 회원만 가능하며 현재 길드의 로그를 ID 내림차순 cursor 방식으로 반환한다.
- `GET /api/v1/collection-completion-logs`는 `limit`(기본 30, 최대 100), 선택적 `cursor`, 선택적 `targetUserId`를 받고 변경자·대상 회원·컬렉션·item·변경 상태·epoch milliseconds 시각을 반환한다.
- Flutter와 기존 웹의 `/api/v2/collections`, `/api/v2/user-collections`, `/api/collections`, `/api/user-collections`, `/api/excluded-members`는 compatibility route로 제공한다.

콘텐츠 참여 그룹 API는 다음 정책을 사용한다.

- 그룹과 편성 목록은 모든 활성 길드원이 조회할 수 있다.
- `GET /api/v1/content-groups/roster`는 같은 길드의 활성 회원을 `id`, `nickname`, `occupation`, `mainClass`, `combatPower` 필드로만 반환한다. 콘텐츠 참여 화면에 필요한 최소 정보이며 아이디, 역할, 장비, 스킬, 부캐 등 전체 프로필은 반환하지 않는다.
- 그룹 생성·이름 변경·삭제와 멤버 편성 변경은 `MASTER`와 `ADMIN`만 수행한다.
- 그룹 이름은 1~30자이며 길드 안에서 대소문자를 구분하지 않고 중복을 금지한다.
- 멤버 저장 요청은 해당 그룹의 전체 `userIds` 배열로 처리하며 빈 배열은 전원 미편성을 의미한다.
- 같은 길드의 활성 회원만 배치할 수 있고 배열 내 중복 ID와 다른 그룹에 이미 편성된 회원을 거절한다.
- 한 회원은 동시에 한 그룹에만 속하도록 service 검증과 DB `UNIQUE(user_id)`를 함께 적용한다.
- 그룹 삭제 시 `group_members`만 cascade 삭제되어 기존 회원은 미편성 상태로 돌아간다.
- Flutter의 원본 그룹 저장 후 대상 그룹 저장 흐름을 지원하며, 중간 실패 시 클라이언트 보상 요청과 전체 재조회가 가능하다.
- 모든 조회·변경은 현재 DB `guildId` 범위로 제한하고 mutation은 `content_group_audit_logs`에 기록한다.
- Flutter의 기존 `/api/groups`, `/api/groups/:id/members` 경로는 compatibility route로 제공한다.

공성전 참여 API는 다음 정책을 사용한다.

- 모든 활성 길드원은 같은 길드의 활성 회원 전체 현황을 조회하고 본인 기록을 저장할 수 있다.
- 목록은 전투력 내림차순으로 반환하며 기록이 없는 회원은 다이아 0, 수정 시각 `null`로 표시한다.
- `MASTER`와 `ADMIN`은 같은 길드의 활성 회원 기록을 수정하고 길드 전체 기록을 초기화할 수 있다.
- 시작 전·종료 후 다이아는 0 이상 999,999,999 이하의 정수이며 종료 후 값은 시작 전 값보다 클 수 없다.
- 사용 다이아는 저장하지 않고 `currentDiamonds - remainingDiamonds`로 계산한다.
- 역할과 활성 상태는 요청 시점의 DB에서 다시 확인하고 모든 조회·변경은 현재 `guildId`로 격리한다.
- 기록 저장과 전체 초기화는 `siege_audit_logs`에 남기며 전체 초기화 감사 정보에는 삭제 건수를 기록한다.
- `/api/v1/siege`는 camelCase 계약을 사용하고 Flutter의 기존 `/api/siege`, `/api/admin/siege/:id` 경로는 compatibility route로 제공한다.

길드원 분배 API는 다음 정책을 사용한다.

- 생성·기간/길드원 입력 수정·계산·확정·재개방·초안 삭제는 현재 DB 역할이 `MASTER`인 사용자만 수행한다.
- `MASTER`는 `DRAFT`, `CONFIRMED`를 모두 조회하고 `ADMIN`·`MEMBER`의 목록에는 `CONFIRMED`만 포함한다. 비마스터가 초안 ID를 직접 조회하면 `DISTRIBUTION_DRAFT_FORBIDDEN`(403)을 반환한다.
- 기간 생성 시 같은 길드의 활성 사용자만 길드원 스냅샷으로 복사한다. 이후 프로필 변경·비활성·탈퇴 여부와 관계없이 해당 기간의 닉네임·직업·클래스·전투력 스냅샷을 사용한다.
- 참여율은 nullable이며 미입력과 0을 구분한다. 연합분배율 기본값은 0, 지급 배율 기본값은 1이다.
- 참여율/연합분배율 pool은 지원비를 먼저 차감한 기본 재원에 각 비중을 적용한다. 각 유효율은 입력값과 지급 배율의 곱이고, 분모가 0이면 해당 pool은 미분배 금액으로 남긴다.
- 초안 입력 수정과 계산값 저장은 하나의 transaction으로 처리한다. 전체 지원비가 재원을 초과하면 `DISTRIBUTION_SUPPORT_EXCEEDS_FUND`(422)로 전부 rollback한다.
- 확정 시 계산 결과를 `distribution_members`에 저장하고 이후 조회는 저장값만 사용한다. 재개방은 사유가 필수이며 처리자·시각·사유를 `distribution_audit_logs`에 기록한다.
- decimal 입력은 JSON number 또는 10진 문자열을 허용하고 응답은 정밀도 손실을 피하기 위해 문자열로 반환한다. 분배 시작일·종료일은 서울 달력 기준 `YYYY-MM-DD` 문자열을 사용한다.
- 기간별 `roundingMode`은 `NONE`, `ROUND`, `CEIL`, `FLOOR` 중 하나다. 중간 계산은 반올림하지 않고 길드원별 최종 지급 단계에만 적용하며 기본값은 `NONE`이다.
- 원본 계산값 `finalDiamonds`와 실제 지급값 `payableDiamonds`, 개인 조정값 `roundingAdjustment`, 전체 차액 `roundingDifference`를 함께 저장·반환한다. 정수화로 생긴 전체 차액은 특정 길드원에게 자동 배정하지 않는다.

## 8. 인증·권한·보안

### 8.1 인증 흐름

1. `POST /api/v1/auth/login` 또는 `POST /api/v1/deputy-auth/login`이 각 계정 저장소에서 아이디·비밀번호를 검증한다.
2. 서버가 사용자 또는 부주 principal을 식별하는 access token을 발급한다. 부주 토큰은 계정의 `token_version`을 포함한다.
3. Flutter는 token을 secure storage에 저장하고 `Authorization: Bearer`로 전송한다.
4. Fastify auth plugin이 token과 현재 DB 계정 상태를 검증하고 `request.user`를 만든다. 부주 요청은 매번 선택한 캐릭터와 활성 상태를 다시 조회한다.
5. route 또는 service가 `MASTER`, `ADMIN`, `MEMBER` 정책을 최종 검사하고, 부주 principal은 별도의 API allowlist로 허용 기능을 제한한다.

현재는 access token 7일을 기본으로 하되, refresh token이 도입되면 만료 정책과 storage 정책을 이 문서에 갱신한다.

운영 JWT 키 교체 시 `JWT_SECRET`은 신규 토큰 서명과 기본 검증에 사용하고, `JWT_PREVIOUS_SECRET`은 기존 토큰의 검증 전용으로 한시 운영한다. 이전 키는 access token 최대 수명 이후 제거한다.

### 8.2 권한 원칙

- UI에서 버튼을 숨기는 것은 보안 조치가 아니다.
- 모든 쓰기 API는 로그인 여부와 역할을 서버에서 확인한다.
- 리소스 소유권 확인이 필요한 경우 역할 검사 후 소유자·길드 범위를 추가 확인한다.
- `MASTER` 계정 삭제·역할 변경·비밀번호 초기화는 별도 policy function을 사용한다.
- 부주는 `users`의 역할이 아니라 길드 전체에 속한 별도 계정이다. `MASTER`·`ADMIN`만 생성·비밀번호 재설정·활성화를 할 수 있고, 부주 계정 자체에는 보스 일정·투표·손지원 매칭·콘텐츠 그룹 조회 외 API 접근을 허용하지 않는다. 단, 활성 캐릭터 선택 없이 본인 프로필을 조회하고 닉네임을 변경하는 것은 허용한다.
- 부주는 같은 길드의 활성 본캐 또는 부캐 하나를 선택해 행동한다. 특정 본캐와 부주 계정의 사전 위임 관계는 만들지 않으며, 부주 계정은 선택 캐릭터를 바꿀 수 있다. 선택 캐릭터 소유자의 권한은 부주에게 승계되지 않는다.
- 부주 기능 제한은 UI가 아닌 auth plugin에서 HTTP method와 경로 allowlist로 최종 적용한다. 보스 정의는 `GET /api/v1/bosses`만 허용하고, 콘텐츠 그룹 화면은 `GET /api/v1/content-groups`와 최소 프로필 응답의 `GET /api/v1/content-groups/roster`만 허용한다. 전체 회원 프로필 `GET /api/v1/members`는 허용하지 않는다. 본인 프로필 조회·닉네임 변경은 활성 캐릭터 선택 없이 허용하며, 그 밖의 기능은 유효한 캐릭터 선택을 요구한다.
- 비밀번호 재설정과 계정 활성 상태 변경은 `token_version`을 증가시켜 기존 부주 JWT를 무효화한다. 비활성화 시 선택 캐릭터도 해제한다.
- 투표 참여 요청의 행위자 계정과 대상 캐릭터를 분리한다. 일반 길드원은 같은 길드의 모든 활성 본캐·부캐를 대상으로 투표할 수 있고, 부주는 현재 선택 캐릭터만 대상으로 할 수 있다. 참여 목록에는 대리 행위자의 계정 종류·ID·닉네임을 표시한다.
- 일정 등록·컷·멍·투표 마감·투표 삭제·컬렉션 타인 수정은 명시적인 permission code를 문서화한다.

### 8.3 비밀값과 입력 보호

- `.env`는 Git에 포함하지 않고 `.env.example`만 제공한다.
- `JWT_SECRET`, OCR secret, DB path, CORS origins는 환경변수로 주입한다.
- 로그인·가입·OCR endpoint에는 rate limit과 body size limit을 적용한다.
- 이미지 OCR은 메모리에서 처리하고 원본 이미지를 SQLite나 서버 디스크에 저장하지 않는다.
- SQL은 모두 prepared statement를 사용한다.
- 로그에서 Authorization, password, token, OCR secret을 redaction한다.

## 9. 데이터 설계

### 9.1 공통 규칙

- 모든 테이블은 `id`, `created_at`, 필요한 경우 `updated_at`을 갖는다.
- 외래키와 unique constraint를 DB에 선언한다.
- 상태 값은 임의의 문자열을 추가하지 않고 TypeScript union과 DB check constraint를 함께 관리한다.
- 삭제가 이력을 보존해야 하는 도메인은 hard delete 대신 state/history 테이블을 사용한다.
- route에서 테이블을 자동 생성하지 않는다. schema 변경은 versioned migration으로 남긴다.

### 9.2 보스 일정·투표 이력

보스 일정의 현재 상태와 과거 이벤트는 분리한다.

```text
boss_definitions
  └─ schedules (현재 일정)
       └─ vote_events (투표 대상 이벤트)
            └─ vote_participants (사용자 참여)

schedule_history / vote_history
  └─ 삭제·교체·상태변경 이후에도 보존되는 이력
```

- 동일 보스라도 `boss + region + spawnTime + type` 조합으로 이벤트를 구분한다.
- 참여자 저장은 사용자가 버튼을 누른 시점에 즉시 transaction으로 처리한다.
- `참여마감`은 참여자와 이력을 보존하고 상태만 `CLOSED`로 변경한다.
- 운영진의 명시적 `삭제`는 정책에 따라 이벤트와 참여자를 제거하거나 `DELETED` 상태로 남긴다. 두 동작을 같은 endpoint로 합치지 않는다.
- 기존 앱에서 합의한 기본 보존 기간은 `spawnTime` 기준 90일이다.
- 정리 작업은 서버 시작 직후 1회와 24시간 주기로 실행한다.
- 보존 기간은 `BOSS_HISTORY_RETENTION_DAYS` 환경변수로 변경한다.

### 9.3 SQLite 운영 규칙

- `PRAGMA foreign_keys = ON`을 항상 설정한다.
- `journal_mode = WAL`을 검토·적용한다.
- `busy_timeout`을 설정한다.
- 쓰기 작업은 짧은 transaction으로 묶고 외부 네트워크 호출을 transaction 안에서 실행하지 않는다.
- 여러 PM2 worker가 같은 SQLite 파일을 쓰지 않는다.
- 일일 backup과 주기적인 복구 테스트를 운영 절차에 포함한다.
- 저장량이 커지거나 동시 쓰기가 증가하면 repository interface를 유지한 채 PostgreSQL 등 외부 DB로 이전한다.

### 9.4 공지 데이터

- `notice_rules`는 길드별 `sort_order`를 가지며 삭제 후 순서를 연속된 값으로 다시 정리한다.
- `price_guides`는 최신 수정 순으로 반환한다.
- `boss_controls`는 `(guild_id, chapter, boss)`를 기본키로 사용하고 기본 `NONE` 상태는 row를 미리 만들지 않고 조회 시 조합한다.
- 공지 본문은 Flutter의 구조화 문자열 호환을 위해 원문 그대로 저장하고 서버에서 `>` 또는 `\\n`을 재해석하지 않는다.

### 9.5 손지원 데이터

- `support_requests`는 요청자, 요청 시간, 상태와 현재 선택된 신청 ID를 저장한다.
- `support_applications`는 `(request_id, applicant_id)` unique 제약으로 중복 신청을 방지한다.
- partial unique index로 요청당 `SELECTED` 신청을 하나만 허용한다.
- 요청 삭제 시 신청은 cascade 삭제하지만 `support_audit_logs`는 운영 이력으로 보존한다.
- 목록은 `OPEN → MATCHED → 종료 상태` 순으로, 동일 상태에서는 최신 요청부터 반환한다.

### 9.6 아이템 현황 데이터

- `collections`와 `collection_items`를 분리하고 item의 정수 ID를 보유 상태의 안정적인 키로 사용한다.
- `user_collection_items`는 `(guild_id, user_id, collection_item_id)` 기본키로 중복 보유 상태를 방지한다.
- `excluded_members`는 `(guild_id, user_id)` 기본키를 사용한다.
- 컬렉션 삭제는 item과 보유 상태를 cascade 삭제한다. 컬렉션 정의 감사 로그는 보존하지만 삭제된 item의 보유 상태 변경 로그는 함께 삭제한다.
- 컬렉션 이름이나 item 표시 문구를 변경해도 동일 item ID의 기존 보유 상태는 유지한다.

### 9.7 콘텐츠 참여 그룹 데이터

- `content_groups`는 길드별 그룹 이름을, `group_members`는 회원 편성과 그룹 내 표시 순서를 저장한다.
- `group_members.user_id` unique 제약으로 한 회원의 다중 그룹 편성을 DB에서도 차단한다.
- 멤버 전체 교체는 활성 회원·중복 편성을 transaction 내부에서 다시 확인한 뒤 삭제·삽입한다.
- 그룹 삭제 후 편성 이력은 `content_group_audit_logs`에 보존하고 회원 계정에는 영향을 주지 않는다.

### 9.8 공성전 참여 데이터

- `siege_records`는 `(guild_id, user_id)` 기본키로 회원당 현재 공성전 다이아 기록 하나를 유지한다.
- `remaining_diamonds <= current_diamonds`와 값 범위는 service 검증과 DB check constraint를 함께 적용한다.
- 전체 초기화는 현재 길드의 `siege_records`만 삭제하며 다른 길드의 기록에는 영향을 주지 않는다.
- 조회 시 활성 `users`를 기준으로 LEFT JOIN하여 미입력 회원도 목록에 포함한다.
- `siege_audit_logs`는 기록 수정과 전체 초기화 이력을 보존하며 공성전 기록 삭제와 cascade되지 않는다.

### 9.9 보스 정의·일정 데이터

- `boss_definitions`는 길드별 보스 유형·지역·이름·쿨타임·고정 시각과 표시 순서를 저장한다.
- `boss_definition_seed_state`는 길드별 기본 보스 생성 여부를 저장해 빈 목록의 의도치 않은 재시드를 방지한다.
- `boss_schedules`는 보스 정의별 현재 일정 하나만 유지하고 보스 정의 삭제 시 cascade 삭제한다.
- `schedule_history`는 일정 occurrence와 투표 이벤트 스냅샷을 보존하며 현재 일정이나 보스 정의 삭제와 cascade되지 않는다. 기존 `vote_hidden` 값은 migration에서 해제하며 일정 삭제·교체 경로에서 더는 변경하지 않는다.
- `participation_targets`는 `(guild_id, type, region, boss)`의 안정적인 보스 키를 저장하며 보스 정의 ID를 외래키로 참조하지 않는다. API 입력의 정의 ID는 service가 현재 길드 정의인지 검증하고 repository에서 안정 키로 저장한다. `boss_participants`, `participation_states`도 모두 guild ID와 정확한 voteKey로 범위를 제한한다.
- 참여 조회는 `BOSS_HISTORY_RETENTION_DAYS` 기준 범위만 반환한다.

### 9.10 보스 참여투표 데이터

- `manual_boss_votes`는 수동 투표의 길드·유형·지역·보스·출현 시각과 축 여부를 저장한다.
- 일정 투표는 별도 복사본을 만들지 않고 `boss_schedules`, `schedule_history`, 고정 `boss_definitions`에서 occurrence를 구성한다.
- 일정 화면 참여와 투표 화면 참여는 동일한 `boss_participants`를 사용해 어느 화면에서 토글해도 상태가 일치한다.
- `participation_states`의 `INACTIVE`, `DELETED` 상태는 투표 목록과 참여 mutation에 동일하게 적용한다.
- `boss_vote_audit_logs`는 수동 투표 등록·삭제, 참여 토글·수동 제외, 투표 마감·삭제의 행위자와 voteKey를 보존한다.
- 스케줄 삭제·초기화·시간 변경은 투표 이벤트나 참여 row를 삭제·재키잉하지 않는다. 명시적 투표 직접 삭제만 선택한 voteKey의 참여를 삭제하고 투표를 숨긴다.

### 9.11 migration 규칙

```text
infrastructure/db/migrations/
├── 001_initial_schema.sql
├── 002_boss_vote_history.sql
└── 003_collection_v2.sql
```

- migration 파일은 한 번 적용되면 수정하지 않는다.
- 적용 순서는 migration table로 기록한다.
- 데이터 변환이 필요한 migration은 backup과 rollback 방법을 문서에 기록한다.
- 운영 DB에서 수동 SQL을 실행한 경우 반드시 다음 migration에 반영한다.

### 9.12 길드원 분배 데이터

- `distribution_periods`는 길드·기간·상태·총 재원·두 배분 비중·현금 환산율·생성/확정 행위자와 시각을 저장한다. API 정본 날짜는 `start_date_iso`, `end_date_iso`의 `YYYY-MM-DD` 값이며 이전 epoch 컬럼은 마이그레이션 호환용으로 유지한다.
- `distribution_members`는 기간 생성 당시 사용자 ID, 닉네임, 직업, 클래스, 전투력과 수기 입력값, 지원비, 계산 결과를 저장한다. `user_id`에는 외래키를 두지 않아 사용자 탈퇴 후에도 과거 정산 스냅샷을 유지한다.
- SQLite의 `DECIMAL` affinity가 내부적으로 binary floating point로 변환될 수 있으므로 금액·비율 컬럼은 정규화된 10진 문자열(`TEXT`)로 저장하고 repository 밖 계산은 `decimal.js` 50자리 유효 정밀도로 수행한다.
- pool과 비중 계산은 정수 반올림하지 않는다. 각 pool의 마지막 유효 대상자에게 50자리 계산에서 발생한 극미한 잔여값을 배정해 정상 분모가 있는 pool의 원본 합계를 정확히 맞춘다.
- 선택한 `rounding_mode`는 최종 원본 다이아에만 적용한다. `ROUND`는 `ROUND_HALF_UP`, `CEIL`은 양의 다이아 올림, `FLOOR`는 양의 다이아 절삭이고 `NONE`은 소수를 유지한다. 현금 환산 원본 `cash_amount`는 반올림 전 `final_diamonds` 기준이다.
- `distribution_audit_logs`는 생성·기간/멤버 수정·계산·확정·재개방·삭제 작업을 기록한다. 초안 본문 삭제 후에도 감사 행은 보존한다.

### 9.13 계정 탈퇴 데이터

- 계정 탈퇴는 하나의 transaction에서 `users` 한 행을 삭제하고 FK `ON DELETE CASCADE`로 `characters`, `alternate_characters`, `support_requests`, `support_applications`, `user_collection_items`, `excluded_members`, `group_members`, `siege_records`, `boss_participants`의 해당 사용자 행만 삭제한다.
- 유일한 `MASTER` 탈퇴는 transaction 안에서 `users`의 같은 `guild_id`에 다른 행이 없는지 재검증한 뒤, MASTER 계정과 `guilds` 행을 삭제한다. 길드 FK가 없는 `schedule_history`와 모든 audit log도 해당 `guild_id`로 명시 삭제하며 다른 길드 행은 변경하지 않는다.
- 탈퇴자가 다른 회원의 손지원 요청에 선택되어 있으면 삭제 전에 그 요청을 `OPEN`으로 되돌리고 `selected_application_id`를 비운다. 탈퇴자 본인의 요청은 신청과 함께 cascade 삭제된다.
- 일반 회원 탈퇴에서는 `guilds`, 길드 설정, 컬렉션·item 정의, 콘텐츠 그룹, 보스 정의·일정, 공지 등 길드 공유 리소스를 보존한다. 유일한 `MASTER` 탈퇴에서는 소유자가 없는 길드와 그 종속 공유 리소스를 함께 삭제한다.
- 법적 보존 의무가 확인된 감사 이력은 없으므로 탈퇴자를 식별하는 행은 `member_audit_logs`, `guild_audit_logs`, `notice_audit_logs`, `support_audit_logs`, `collection_audit_logs`, `content_group_audit_logs`, `siege_audit_logs`, `boss_audit_logs`, `schedule_audit_logs`, `boss_vote_audit_logs`에서 함께 hard delete한다. 직접 actor/target 컬럼뿐 아니라 JSON의 대상 `userId`·멤버 ID 배열·username·nickname과 탈퇴자의 요청·신청을 가리키는 행도 포함한다.
- 공유 리소스 자체를 지우지 않기 위해 `notice_rules.created_by`, `price_guides.created_by`, `boss_controls.updated_by`, 다른 회원의 `siege_records.updated_by`, `boss_schedules.created_by`, `schedule_history.created_by`, `participation_states.updated_by`, `manual_boss_votes.created_by`가 탈퇴자이면 복구 불가능한 비회원 sentinel `0`으로 치환한다.
- 애플리케이션은 IP·세션·요청 이력을 DB에 저장하지 않는다. Fastify request logger도 IP와 port를 직렬화하지 않으며 Authorization과 password 경로를 redaction한다. reverse proxy·호스팅 사업자 등 애플리케이션 외부 로그의 삭제·보존은 별도 인프라 정책으로 관리한다.

### 9.14 FCM 기기 토큰과 발송 이력

- `push_device_tokens`는 사용자·길드·Android FCM 토큰·선택적 `device_id`와 마지막 확인 시각을 저장한다. 토큰은 전역 unique이며 `(user_id, device_id)`도 unique이다.
- `push_delivery_history`는 보스 occurrence, 알림 시점(300/60/0초 전), 사용자·설치 기기 키, 상태, 시도 횟수, claim 만료·재시도·성공 시각과 안정적인 오류 코드만 저장한다.
- 기기 토큰 삭제 후에도 중복 방지를 위한 발송 이력은 보존한다. 사용자 또는 길드 삭제 시에는 외래키 cascade로 해당 이력을 함께 삭제한다.
- FCM 호출 성공과 DB 성공 기록은 하나의 원자적 transaction으로 묶을 수 없으므로 프로세스가 FCM 성공 직후 종료되는 극히 작은 구간에는 lease 만료 후 재발송 가능성이 있다. 정상 cron 중복·재실행은 DB unique key로 차단한다.

## 10. 외부 OCR 연동

```text
Flutter 이미지 선택
  → POST /api/v1/ocr/boss-schedule
  → Fastify raw image body 검증
  → CLOVA OCR client
  → 정규화된 OCR 결과 반환
  → 사용자가 검토
  → 별도의 schedules 등록 API 호출
```

- OCR 분석과 일정 저장을 한 transaction/endpoint로 묶지 않는다.
- OCR 결과에는 확정된 DB id를 부여하지 않는다.
- 템플릿 선택 권한과 사용 가능한 template 목록을 서버에서 제한한다.
- 기존 웹의 `/api/ocr/templates`, `/api/ocr/boss-schedule`는 동일한 권한·크기 제한을 적용하는 compatibility route로 제공한다.
- 외부 API timeout, 재시도 횟수, 원격 오류는 별도 error code로 변환한다.
- 원본 이미지는 저장하지 않는다.

## 11. 운영·배포

### 11.1 개발

- `src/app.ts`는 import만 해도 테스트 가능한 구조로 유지한다.
- 개발 서버는 `tsx watch` 또는 동등한 방식으로 실행한다.
- `.env.example`에 필수 환경변수와 예시만 기록한다.

### 11.2 운영

- TypeScript를 `dist/`로 빌드하고 production dependency만 설치한다.
- Naver Cloud Micro에서는 Fastify 단일 fork만 실행한다.
- PM2를 사용한다면 `fork` 모드만 사용하고 cluster mode는 사용하지 않는다.
- Docker는 초기 운영에서 사용하지 않는다. 이미지와 daemon 오버헤드가 필요하지 않기 때문이다.
- Nginx 또는 Naver Cloud HTTPS 계층에서 TLS를 종료하고 Fastify는 내부 포트에서 대기한다.
- 기존 웹 전환 기간에는 정적 웹과 제외 기능을 기존 3000 포트에서 유지하고, `api.hanul-on.cloud/api/...`는 Nginx가 Fastify 3001 포트로 전달한다. 범위에서 제외된 `/api/janken/...`과 `/api/test-discord`만 기존 서버로 전달한다.
- `/api/v1/health/live`는 프로세스 생존만 확인한다.
- `/api/v1/health/ready`는 DB 연결과 migration 상태까지 확인한다.
- `SIGTERM` 수신 시 신규 요청을 받지 않고 요청·DB 작업을 정리한 뒤 종료한다.
- 보스 푸시는 빌드 후 `ops/systemd/hanulon-boss-push.service`와 `.timer`를 설치해 약 10초 간격으로 실행한다. 표준 cron의 1분 해상도는 최대 약 59초의 발송 지연을 만들 수 있으므로 사용하지 않는다.
- timer 작업에는 API 서버와 같은 `DB_PATH`, `JWT_SECRET` 및 `FCM_SERVICE_ACCOUNT_FILE`(또는 `FCM_SERVICE_ACCOUNT_JSON`)이 필요하다. 현재 운영 구성은 `WorkingDirectory`의 `.env`를 읽는다. 서비스 계정 파일은 저장소 밖에 두고 실행 계정만 읽을 수 있게 `chmod 600`을 적용한다.
- `FCM_DISPATCH_WINDOW_SECONDS` 기본값은 90초다. 일시적인 timer 지연·재시작 복구 범위이며 지나치게 크게 설정하면 오래 지난 출현 알림이 발송될 수 있다.

### 11.3 로그와 모니터링

- Fastify 기본 Pino logger를 사용한다.
- 모든 요청에 `requestId`를 연결한다.
- method, path, statusCode, durationMs만 기본 기록하고 개인정보는 최소화한다.
- 5xx, DB 오류, OCR timeout, migration 실패는 error level로 기록한다.
- 다음 지표를 확인한다: 메모리, event loop delay, SQLite 파일 크기, 5xx 비율, OCR latency, backup 성공 여부.

## 12. 테스트 기준

### 12.1 단위 테스트

- 보스 `spawnTime`과 Asia/Seoul 날짜 변환
- 투표 `voteKey` 생성·분리
- 90일 보존 기간 계산
- 역할·permission 판정
- 상태 전이: OPEN → CLOSED, OPEN → DELETED
- OCR 결과 정규화
- 페이지·필터·정렬 조건
- 분배 pool 정규화, 지급 배율, nullable 참여율, 지원비 차감, 0 분모와 decimal 합계

### 12.2 Route 테스트

- `fastify.inject()`로 실제 HTTP 계약을 테스트한다.
- 정상 응답 JSON schema와 오류 응답 schema를 함께 검증한다.
- 401, 403, 404, 409, 422를 각각 고정한다.
- token 없는 요청, 잘못된 role, 다른 사용자의 리소스 접근을 테스트한다.
- 분배 초안 가시성, MASTER 전용 mutation, 확정 후 수정 차단, 재개방과 스냅샷 보존을 테스트한다.
- 길드별 연합분배율 구간 설정은 모든 활성 길드원이 조회하고 `MASTER`만 변경한다. 구간은 80,000~89,999, 90,000~99,999, 100,000~104,999부터 시작해 이후 5,000 단위로 연속되어야 하며 새 분배 기간의 전투력 스냅샷에 자동 적용한다.

### 12.3 통합 테스트

- 임시 SQLite 파일 또는 in-memory DB를 사용한다.
- migration → seed → route 호출 순서로 검증한다.
- 로그인 → 내 정보 → 일정 등록 → 투표 이벤트 생성 → 참여 → 통계 조회 흐름을 검증한다.
- 시간 정정·재등록에서 이전 voteKey·참여자·마감 상태가 유지되고, 같은 시각을 다시 등록해도 해당 occurrence가 재사용되며 transaction rollback이 동작하는지 검증한다.
- 일정 단일 삭제·전체 초기화·보스 초기화와 시간 변경·재등록 후 이력·참여자 보존 및 투표 목록·통계를 검증한다.
- 운영진의 voteKey 직접 삭제는 정확한 참여 row만 삭제하고 다른 투표를 유지하며, 권한 없는 사용자는 403을 받는지 검증한다.
- 90일 이전 이력 cleanup과 backup 전제 조건을 검증한다.
- OCR client는 실제 외부 API 대신 mock server를 사용한다.

### 12.4 계약 테스트

- TypeBox request/response schema와 실제 `fastify.inject()` 응답을 함께 검증한다.
- Flutter DTO fixture와 실제 응답의 필드명·nullability·enum을 비교한다.
- API breaking change가 발생하면 이 문서와 Flutter repository를 같은 변경 단위로 수정한다.

## 13. 기능 추가·수정 절차

다음 순서를 지킨다.

1. 이 문서에서 관련 module, 권한, 데이터 보존 규칙을 확인한다.
2. 변경이 API 계약·DB schema·Flutter DTO 중 어디에 영향을 주는지 표시한다.
3. 상태 값과 오류 code를 먼저 정의한다.
4. migration과 repository query를 작성한다.
5. domain/service에 업무 규칙을 구현한다.
6. schema와 route를 연결한다.
7. route·service·integration 테스트를 추가한다.
8. 이 문서와 Flutter 설계 문서를 갱신한다.
9. `npm run lint`, `npm run typecheck`, `npm test`, migration 검증을 실행한다.
10. 이 절의 체크리스트와 문서의 결정 로그를 갱신한다.

### 13.1 기능 추가 체크리스트

- [ ] module 경계가 명확한가?
- [ ] MASTER/ADMIN/MEMBER 권한이 문서화되었는가?
- [ ] API 경로가 `/api/v1`인가?
- [ ] 입력·출력 schema가 있는가?
- [ ] DB 변경이 migration으로 기록되었는가?
- [ ] transaction과 동시 요청 처리가 정의되었는가?
- [ ] 시간대와 날짜 필터가 Asia/Seoul 기준인가?
- [ ] 오류 code와 status code가 정의되었는가?
- [ ] 민감정보가 로그·응답·Flutter에 노출되지 않는가?
- [ ] 단위·route·통합·계약 테스트가 필요한 수준으로 추가되었는가?
- [ ] Flutter API 문서와 mock/DTO가 갱신되었는가?

### 13.2 수정 체크리스트

- [ ] 기존 API 응답을 사용하는 Flutter 화면을 확인했는가?
- [ ] 기존 데이터와 migration 호환성을 확인했는가?
- [ ] 기존 상태·이력 보존을 깨뜨리지 않는가?
- [ ] breaking change라면 버전 또는 compatibility route가 있는가?
- [ ] 실패 시 rollback 또는 복구 방법이 있는가?

## 14. 구현 순서

### Phase 0. 기반

- TypeScript strict 프로젝트 생성
- Fastify app/server 분리
- 환경변수 검증
- 공통 error, request-id, logger, CORS, JWT plugin
- SQLite client, migration runner, health endpoint
- TypeBox schema와 `fastify.inject()` 테스트 기반

### Phase 1. 인증과 핵심 일정

- auth, guild, members
- bosses, schedules
- 서버 시간과 Asia/Seoul 유틸리티
- participation targets와 participants

### Phase 2. 투표·공지

- boss-votes와 immutable history
- 마감·삭제·통계·참여율
- notices와 보스 통제
- 90일 cleanup

### Phase 3. 운영 기능

- collections V2
- support
- content-groups
- siege

### Phase 4. OCR과 운영 안정화

- CLOVA OCR proxy
- rate limit·backup·복구 테스트
- TypeBox/Flutter contract test
- Naver Cloud Micro 배포 검증

## 15. 결정 로그

| 날짜       | 결정                              | 이유                                                                                             |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| 2026-08-10 | Node.js LTS + Fastify v5 채택     | 기존 Node 생태계와 호환하면서 Spring보다 가벼운 API 서버가 필요함                                |
| 2026-08-10 | TypeScript strict 사용            | Flutter API 계약과 복합 도메인의 필드 오류를 줄임                                                |
| 2026-08-10 | `/api/v1` 신규 계약 사용          | legacy 웹 API와 새 Flutter API를 분리하고 breaking change를 관리함                               |
| 2026-08-10 | SQLite 유지                       | 단일 Micro 서버와 소규모 길드 운영에 충분하며 DB 서버를 별도로 띄우지 않음                       |
| 2026-08-10 | SQL Repository 사용               | 무거운 ORM을 피하고 migration·transaction을 직접 통제함                                          |
| 2026-08-10 | Discord·짱깸보 제외               | 새 Flutter 앱 범위에서 제외되었고 Micro 서버의 상시 작업 부담을 줄임                             |
| 2026-08-10 | 보스 이력 90일 보존               | 저장공간 제한을 고려하면서 이전 수요일 참여현황을 보존하기 위함                                  |
| 2026-08-11 | Phase 0 기반 구현 시작            | Fastify app/server 분리와 migration·health·time 계약을 먼저 고정함                               |
| 2026-08-11 | `better-sqlite3` 채택             | 소규모 단일 서버의 짧은 prepared statement 작업을 단순하게 유지함                                |
| 2026-08-12 | 인증·프로필·길드원 API 구현       | Flutter legacy 경로를 호환하면서 `/api/v1` 정본과 DB 기반 tenant·역할 검증을 적용함              |
| 2026-08-12 | 마스터 설정·가입 코드 API 구현    | 역할별 단일 가입 코드와 DB 기반 권한 재검증 및 설정 변경 감사 기록을 적용함                      |
| 2026-08-12 | 공지·가격표·보스 통제 API 구현    | 길드별 데이터 격리, 운영진 권한, 전체 순서 검증과 변경 감사 기록을 적용함                        |
| 2026-08-12 | 손지원 매칭 API 구현              | 요청·신청 소유권, 명시적 상태 전이, 단일 선택 제약과 길드별 감사 기록을 적용함                   |
| 2026-08-12 | 아이템 현황 V2 API 구현           | 안정적인 item ID, 길드별 보유 상태, 역할별 수정 권한과 cascade 정책을 적용함                     |
| 2026-08-12 | 콘텐츠 참여 그룹 API 구현         | 단일 그룹 편성 제약, 운영진 권한, 길드별 멤버 검증과 감사 기록을 적용함                          |
| 2026-08-12 | 공성전 참여 API 구현              | 다이아 범위·잔여값 검증, 길드 격리, DB 기반 운영진 권한과 초기화 감사를 적용함                   |
| 2026-08-12 | 보스 일정·참여 API 구현           | occurrence 이력 보존, 서버 쿨타임 계산, 길드 격리와 참여 중복 방지를 적용함                      |
| 2026-08-12 | 보스 참여투표 API 구현            | 일정·이력·수동 투표 병합, 원자적 참여 토글, 마감 상태와 길드 격리를 적용함                       |
| 2026-08-23 | Android FCM 보스 일정 알림 구현   | 사용자 기기 토큰 API, HTTP v1 서비스 계정 인증, 5분·1분·출현 알림과 발송 중복 방지 이력을 적용함 |
| 2026-08-24 | 길드원 분배 API 구현              | 50/50 정규화, 정확한 decimal 계산, 확정 스냅샷, MASTER 전용 상태 전이와 감사 이력을 적용함       |
| 2026-08-24 | 최종 지급 다이아 반올림 선택 추가 | 원본 계산을 보존하면서 소수 유지·반올림·올림·절삭 실제 지급값과 전체 차액을 함께 제공함          |
| 2026-08-24 | 길드별 연합분배율 구간 설정 추가 | 전투력 구간별 기본 연합분배율을 영구 저장하고 새 분배 스냅샷에 일관되게 자동 적용하기 위함       |
| 2026-08-24 | 엑셀 재원 입력·합산 계약 반영 | 공성 다이아·길드 현금·스크롤 제작·즉시부활을 기간별로 저장하고 전체 재원·지원비 차감 재원·현금 환산 합계를 서버에서 계산하기 위함 |
| 2026-09-17 | 일정 occurrence와 투표 삭제 경계 분리 | 일정 삭제·초기화·정정이 투표 이력과 참여를 숨기거나 이동하지 않도록 하고, 운영진의 정확한 voteKey 직접 삭제만 참여 기록을 제거하도록 함 |
| 2026-10-05 | 길드 공용 부주 계정과 캐릭터별 대리 참여 | 캐릭터 위임 등록 없이 길드원이 대리 투표할 수 있게 하고, 부주 계정은 선택 캐릭터만 제한 기능에서 사용하며 행위자를 별도 기록함 |
| 2026-10-06 | 부주 화면 조회 경로 보완 | 일정 화면의 보스 정의 조회를 허용하고 콘텐츠 그룹용 최소 회원 명단 API를 분리해 전체 프로필 노출 없이 조회를 완성함 |
| 2026-10-06 | 부주 본인 닉네임 변경 허용 | 본인 계정만 수정하도록 제한하고 변경 행위와 이전·새 닉네임을 감사 로그에 보존함 |

새로운 기술 선택이나 기존 결정을 뒤집는 변경은 이 표에 날짜·대안·선택 이유를 추가한다.
