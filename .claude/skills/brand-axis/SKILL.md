---
name: brand-axis
description: 본사(브랜드) 축 작업 절차 — 브랜드 테이블·정의자 RPC·본사 대시보드 화면·점주 앱 연결 화면·배포·정산을 만들거나 고칠 때. 경계 체크리스트 → 마이그레이션 번호 실측·dry-run → RPC 본문 확인 → qa:brand* 4종 → 미연결 매장 diff → 버전 규칙 케이스 순으로 닫는다. 트리거 — "본사", "브랜드", "배포 축", "가맹", "brand_", "/hq", "/brand-axis".
---

# 본사 축 작업 절차 (brand-axis)

규칙 원문 = `.claude/rules/brand-boundary.md`. 스펙 = `기획/본사대시보드/00_기획정본_2026-09-22.md`. 순서·도구 = `01_구현계획_2026-09-22.md`.
허브 메모리 = `project_squaretable_hq_console`. 웹 진입 규칙 = `project_squaretable_web_entry_structure`.

## 0. 착수 전 경계 체크리스트 (전부 "아니오"여야 시작)

| 물음 | 아니오면 |
|---|---|
| 본사가 매장 테이블을 읽는 RLS 정책을 추가하나? | → 정의자 RPC 로 바꾼다 |
| 개인 축(급여·근태·개인 이수·채팅·직원 이름·전화)이 본사 응답 어디에든 실리나? | → 컬럼을 뺀다. 수준 무관 |
| 수락 전 본사에 매장명·계정이 보이나? | → 초대 행은 번호만 |
| 본사 화면에 매장 앱 화면·460 프레임을 끼우나? | → `components/hq/` 데스크톱 컴포넌트 |
| 본사 RPC 가 `quiz_assignments`·직원 할일을 만드나? | → 매장 엔진에 맡긴다 |
| 미연결 매장이 이 변경으로 달라지나? | → 필터·기본값을 다시 본다 |

## 1. DB — 번호 실측 · 재정의 · dry-run

1. `npx supabase migration list` 로 **원격 최신 번호**를 실측한다(2026-09-22 기준 0208). 파일명은 `02xx_brand_<축>.sql`, 축별 분리(조직 → 조회 → 연결 → 배포 → 결제).
2. 기존 함수를 재정의하면 AGENTS ⑧: `grep -n "function public.<이름>" supabase/migrations/*.sql` 전수 → **최고 번호를 베이스** → 주석(설계 근거)도 같이 옮긴다.
3. 정의자 RPC 는 `security definer set search_path = public`, 술어는 `(select public.auth_brand_id())` 래핑(db-rls). `grant execute … to authenticated` 를 빠뜨리지 않는다.
4. `brand_*` 테이블은 `enable row level security` + **정책 0개**. 쓰기는 전부 RPC.
5. push 전 `migration list` 로 딸려 올라갈 다른 작업분 확인 → `npx supabase db push`.
6. 적용 **후** `select pg_get_functiondef('public.<rpc>'::regproc)` 로 본문이 의도한 베이스인지 본다.

## 2. 클라이언트

- RPC 호출부 = `src/lib/brand/brandDb.ts`(`db.ts` 에 섞지 않는다). 상태 = `src/lib/store/useBrandStore.ts`(RPC 1회 → 캐시 → 포커스·수동 새로고침, realtime 없음).
- 본사 화면 = `src/app/hq/*` + `src/components/hq/*`(표시 전용, 행 배열만 받는다). 로직은 `src/lib/ai/`·`src/lib/quiz/`·`src/lib/db.ts` 를 작업실 unit 으로 그대로 부른다.
- 점주 앱 신규 호출 6개 이내(규칙 파일). 신규 탭 0. 웹 진입은 `AppShell.web` 이 자격 뒤에 셸을 씌운다 — 새 라우트 그룹을 만들면 `qa:hq` G 케이스처럼 "미로그인·무자격에 사이드바 0"을 케이스로 고정.

## 3. 검증 (순서대로, 사이 45~90초)

| 명령 | 무엇을 실증하나 | 단계 |
|---|---|---|
| `node scripts/seed-brand-demo.mjs` | 고정 계정 `hq@pilot…` + `brand_pilot` 멱등 시드(연결 매장·수준·배포 상태는 그 테이블이 생기는 단계에서 추가) | 전부 |
| `npm run qa:brand` | 교차 브랜드 0행 · 작업실이 매장 목록에 안 뜸 · 미연결 매장 diff 0 | P2~ |
| `npm run qa:brand-boundary` | §3-4 금지 행 전부 0행/거부 · 수준별 컬럼 null · 수락 전 매장명 0 | P2~ (RLS·RPC 변경 시 필수) |
| `npm run qa:brand-deploy` | 사본 생성 · 미수정 자동 갱신 · 수정본 대기 · 교체/유지 · 숨김 유지 · 해제 후 잔존 · 사진 열람 | P4~ |
| `npm run qa:brand-billing` | 청구액 = payer=brand 매장 수 × 계약가 · 월 중 추가는 다음 청구 · 해제는 당월 말 유지 · IAP 전환 거부 | P6 |
| `npm run qa:hq` | 셸 3갈래 + 셸 경계(G) 브라우저 실측(playwright 는 npx 캐시 복사 → 삭제, 메모리 `qa_harness_traps` 11) | 전부 |
| 기존 `crosstenant`·`qa:onboarding`·`qa:roles`·`qa:quiz-schedule`·`qa:ai-core` | 회귀 0 | 해당 축 |

하니스 URL 결정 줄을 먼저 읽는다(`grep -n "SUPABASE_URL" scripts/<하니스>.mjs`) — QA_* 를 무시하고 라이브를 치는 하니스가 있다.

## 4. 버전 규칙 케이스 (P4~, 하니스에 그대로)

미수정 사본 → 재배포 시 내용 갱신 + `brand_version` 올림, `local_modified_at` null 유지 / 수정 사본 → 갱신 안 함 + `brand_pending_version` / 교체 → 내 수정 버림 / 유지 → 대기 유지 / 숨김 → 갱신되되 숨김 유지 / 해제 → 사본 잔존·링크만 끊김.

## 5. 끝낼 때

커밋은 단계 단위. 웹 배포 = main 머지 → **푸시 전 사용자 확인**(심사 중 push 금지 규칙). 단계 지시서(루트 `메가프롬프트_본사대시보드_P<n>_*.md`)는 끝나면 `_보관/본사·프랜차이즈/지시서/` + 연혁 §3 한 줄. 허브 메모리 상태 줄 갱신.
