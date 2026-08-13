# Odin Guild API

Flutter 앱을 위한 Fastify 기반 API 서버입니다. 구조와 변경 규칙은 [`docs/backend-architecture.md`](docs/backend-architecture.md)를 기준으로 합니다.

## 기술 스택

- Node.js LTS
- TypeScript strict
- Fastify v5
- SQLite + `better-sqlite3`
- JWT plugin
- TypeBox request/response schema

## 로컬 실행

```bash
npm install
cp .env.example .env
npm run dev
```

`.env`의 `JWT_SECRET`은 32자 이상의 임의 문자열로 설정합니다.

확인할 수 있는 초기 endpoint:

- `GET http://127.0.0.1:3001/api/v1/health/live`
- `GET http://127.0.0.1:3001/api/v1/health/ready`
- `GET http://127.0.0.1:3001/api/v1/time`

## 검증 명령

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

현재 Phase 0 기반과 health/time, 로그인·회원가입, 내 정보 조회·수정, 길드원 명단·관리, 마스터 설정·가입 코드, 공지·가격표·보스 통제, 손지원 매칭, 아이템 현황 V2, 콘텐츠 참여 그룹, 공성전 참여, 보스 정의·일정·참여, 보스 참여투표·통계, CLOVA OCR proxy API가 구현되어 있습니다. 기존 웹과 Flutter의 현재 `/api/...` 경로는 호환 route로 제공하고 신규 계약은 `/api/v1`을 기준으로 확장합니다. 짱깸보와 Discord 기능은 기존 웹 서버에 남겨 둡니다.
