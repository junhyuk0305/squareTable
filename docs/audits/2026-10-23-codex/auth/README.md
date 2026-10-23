# AUTH-LIFE-01 검증

운영 호출 없이 별도 DB와 별도 PostgREST로 실행했다. 합성 사용자만 만들었으며 실제 RLS와 트리거를 유지했다. 서명 JWT는 이 환경에서 생성한 임시 키로 만들었다. 로그인과 토큰 갱신 서버를 실행한 검사는 아니다.

## 현재 결과

- 최종 회귀 단언 26개 통과. 실제 HTTP 18건과 SQL 상태 검사를 합친 수다. 정상 owner, 다른 매장 거절, 자기 자료, 탈퇴 후 재접근, 직원 있는 사장, 닫힌 매장 예외, 익명 공유, 서비스 역할, 신규 가입을 포함한다.
- 실제 두 SQL 접속에서 잠금 대기를 확인한 승인/탈퇴 경쟁 2개 통과.
- 기존 탈퇴자의 ban, 세션 제거, 활성 매장 포인터 제거와 stale JWT 거부 확인.
- REST 검사 없이 직접 authenticated RLS를 검사한 5개 항목 통과. Storage 자기 자료 허용, 다른 매장과 탈퇴 계정 거부, 탈퇴 개인 설정 쓰기 차단, 정책 누락 0개를 확인했다.
- 별도 새 DB에서 최종0335 전체를 적용했다. HTTP 검사 DB와 public 함수 386개의 digest가 일치했다.
- 최종 파일 SHA256: `9a5267d31f4856b43961b800c77dba95c4dc2011bffc3b0ae127f13cbccfc7fb`.

`0335-applied.json`은 최초 적용 버전이다. 이후 익명 공유 정상 대조에서 pre-request의 함수 권한 오류가 발견돼 역할 검사를 별도 IF로 분리했다. `prehook-final-applied.json`과 최종 `green-http-results.json`을 함께 읽어야 한다. 경쟁 결과는 이 수정 전 버전에서 얻었으며, 경쟁 관련 함수 본문은 이후 바뀌지 않았다. 전체 파일의 새 DB 적용 결과는 별도 증거로 구분한다.

## 안전한 재실행

필수 조건: 로컬 Docker의 `supabase_db_SquareTable`, `supabase_rest_SquareTable`, 0334까지의 전체 스키마 기준 환경. source DB에 0335가 이미 적용돼 있으면 이 스크립트로 RED를 만들 수 없다. 운영 연결 파일을 사용하지 않는다. 소스 DB는 스키마만 읽고 새 `audit_auth_full_*` DB를 만든다. 환경 준비 과정에서 원본 데이터를 복사하지 않는다.

저장소 루트에서 순서대로 실행한다.

```text
node docs/audits/2026-10-23-codex/auth-environment/prepare.cjs
node docs/audits/2026-10-23-codex/auth-environment/start-http.cjs
node docs/audits/2026-10-23-codex/auth/http-regression.cjs red
node docs/audits/2026-10-23-codex/auth/apply-isolated.cjs
node docs/audits/2026-10-23-codex/auth/http-regression.cjs green
node docs/audits/2026-10-23-codex/auth/race-regression.cjs
node docs/audits/2026-10-23-codex/auth/direct-rls.cjs
node docs/audits/2026-10-23-codex/auth/full-final-apply.cjs
node docs/audits/2026-10-23-codex/auth/cleanup-isolated.cjs
```

RED의 실패 종료 코드는 예상된 결함 재현이다. 다음 단계로 진행하기 전 정상 대조군은 통과했는지 확인한다. 이 스크립트는 자기 폴더에 결과를 쓰므로 보존된 기록을 덮어쓰지 않으려면 별도 체크아웃에서 실행한다. 준비 환경 manifest는 생성 후 로컬에서만 사용한다. DB 덤프와 manifest를 저장소에 추가하지 않는다. 실제 HTTP 검사는 임시 서버의 DB 설정 반영 뒤 수행한다.

`최종독립검토.md`는 구형 앱의 RPC 및 사용자 안내 계약과 보안 경계를 검토한다. `0335-edge-final-review.md`는 Auth 및 Edge의 미검증 범위를 구분한다. Storage 서비스 HTTP와 실기기 동작을 통과한 기록은 아니다.
