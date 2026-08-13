# odin_guild_api 작업 지침

이 문서는 이 저장소에서 작업하는 Codex와 개발자가 지켜야 하는 공통 규칙이다.

## 작업 시작 전 필수 참조

백엔드 기능을 추가하거나 수정하기 전에 반드시 다음 문서를 먼저 읽는다.

- [`docs/backend-architecture.md`](docs/backend-architecture.md)

Flutter 클라이언트와 API 계약을 변경하는 작업이라면 다음 문서도 함께 확인한다.

- `/Applications/XAMPP/xamppfiles/htdocs/my-prj/odin_guild_app/docs/flutter-frontend-architecture.md`

문서와 구현이 다르면 코드를 임의로 문서 기준에 맞추거나 문서를 무시하지 말고, 변경 범위를 확인한 뒤 두 내용을 함께 갱신한다.

## 아키텍처 준수 규칙

- 런타임은 Node.js LTS, 프레임워크는 Fastify v5, 언어는 TypeScript를 사용한다.
- API 전용 서버로 운영한다. Flutter 앱과 정적 파일을 백엔드에서 제공하지 않는다.
- 모든 신규 API는 `/api/v1` 아래에 만든다.
- Route는 입력 검증·인증 연결·응답 변환만 담당한다. 업무 규칙은 service/use case에 둔다.
- SQL은 route나 service에 직접 작성하지 않고 repository에 둔다.
- DB 변경은 migration으로 관리하며 서버 시작 시 임의의 `CREATE TABLE`을 추가하지 않는다.
- 역할 검사는 화면이 아니라 백엔드에서 최종 수행한다.
- OCR 비밀값과 JWT 비밀키는 환경변수로만 관리하며 소스·Flutter 앱·로그에 남기지 않는다.
- Discord와 짱깸보는 현재 앱 범위에서 제외한다. 다시 추가하려면 범위와 운영 비용을 문서에 먼저 기록한다.

## 기능 추가·수정 체크리스트

1. 해당 기능이 어느 module에 속하는지 `backend-architecture.md`에서 확인한다.
2. API 계약, 권한, 오류 코드, 시간대, 데이터 보존 정책을 먼저 결정한다.
3. 필요한 DB 변경을 migration으로 추가한다.
4. schema → route → service → repository → 외부 연동 순서로 구현한다.
5. 단위 테스트와 route/integration 테스트를 추가한다.
6. API 계약이 바뀌면 `docs/backend-architecture.md`와 Flutter 설계 문서를 함께 갱신한다.
7. 작업 완료 전에 문서의 변경 체크리스트와 테스트 기준을 다시 확인한다.

## 코드 스타일

- TypeScript strict 모드를 유지한다.
- 외부 입력은 JSON Schema/TypeBox로 검증한다.
- 도메인 모델과 DB row, HTTP DTO를 분리한다.
- 에러는 공통 `AppError`와 안정적인 `code`를 사용한다.
- 비동기 외부 API 호출을 SQLite transaction 안에서 실행하지 않는다.
- 로그에는 비밀번호, JWT, OCR secret, 전체 Authorization header를 기록하지 않는다.

## Git 요청 규칙

사용자가 정확히 `커밋`이라고 입력하면, 작업에 해당하는 `git add` 명령어와 한글 커밋 메시지만 작성한다. 직접 커밋하거나 푸시하지 않는다.
