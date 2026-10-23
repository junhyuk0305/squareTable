# 0335 Auth ban 최종 독립 검토

판정: 코드에서 차단 원인 확인. 실제 GoTrue HTTP 재현은 미수행. 제품 및 DB를 변경하지 않았다. 전체스키마 REST 검사는 storage_audit가 별도로 담당한다. 근거 파일 해시와 시각은 0335-edge-final-evidence.json에 있다.

## 차단 범위

0335는 새 탈퇴의 기존 세션을 삭제하고 public 프로필을 비활성화한 같은 트랜잭션에서 auth.users.banned_until을 미래 100년으로 설정한다. 기존 탈퇴자는 deleted_at이 있는 프로필만 join해서 ban하고 세션을 지운다. 활성 계정의 ban이나 세션을 이 backfill이 변경하지 않는다. greatest는 더 긴 기존 ban을 줄이지 않는다. NULL은 미래 시각으로 대체한다.

GoTrue v2.197.0 공식 auth.go는 사용자/세션 조회 후 미래 banned_until인 사용자를 거부한다. session_id가 있는 토큰의 세션이 없으면 그 전에 거부한다. session_id가 없는 구형 토큰도 사용자 ban 검사 대상이다. token.go 비밀번호 로그인도 User is banned 오류로 거부한다. 유한 시각을 써서 infinity 파싱 문제를 피했다. 로컬 컨테이너 버전은 v2.197.0이다. 운영 버전과 실제 timestamp 읽기 성공을 이번 검토가 보증하지는 않는다.

- https://raw.githubusercontent.com/supabase/auth/v2.197.0/internal/api/auth.go
- https://raw.githubusercontent.com/supabase/auth/v2.197.0/internal/api/token.go

서비스 권한 Edge에서 getUser를 호출한 뒤 처리하는 카드/푸시/AI 갈래는 신규 요청 단계에서 차단될 근거가 있다. 반대로 getUser를 통과한 직후 탈퇴가 커밋되는 요청은 소급 취소되지 않는다. 특히 이미 시작된 외부 결제 호출의 취소나 원자성은 이번 변경의 보장 범위가 아니다. 서비스 웹훅·갱신 작업과 익명 OTP를 일괄 차단하지 않는 현재 범위는 필요하다.

## 구형 앱 영향

RPC 이름·인자·반환은 그대로다. 활성 계정과 프로필 작성 전 계정은 account_access_allowed가 허용한 뒤 기존 정책을 계속 적용한다. 실제 출시 바이너리와 전 역할 조합을 실행하지 않았으므로 전체 구형 앱 호환 통과라고 판정하지 않는다.

탈퇴 후 다시 로그인하는 경로는 UX 변화가 있다. 현재 useSessionStore는 Auth 로그인 실패를 friendlyError로 먼저 반환한다. 이전에는 loadProfile의 deleted_at 검사에서 탈퇴 안내를 반환했지만, ban 이후에는 그 단계에 도달하지 않는다. userError.ts에 banned 매핑이 없어서 비밀번호 재확인 문구가 표시된다. 실제 userError 모듈을 TypeScript로 변환해 격리 실행한 결과:

- 입력 User is banned → 이메일 또는 비밀번호를 다시 확인해 주세요.
- 정상 대조 auth session is inactive → 로그인이 만료됐어요. 다시 로그인해 주세요.

이는 화면 실행이 아닌 실제 문구 변환 함수 실행이다. 보안 차단 실패는 아니지만, 올바른 비밀번호를 다시 입력하도록 유도한다. 제품은 수정하지 않았다. 향후 별도 개선 시 Auth user_banned는 관리자가 정지한 계정도 포함하므로 무조건 탈퇴 계정이라고 설명하면 안 된다.

다른 기기의 옛 화면은 캐시를 즉시 지우는 명령을 받는 것이 아니다. 다음 서버 요청이 거부된다. 이미 기기에 받은 자료를 소급 삭제한다고 설명하면 안 된다. 탈퇴 RPC 응답 유실 후 재시도는 401로 거부될 수 있으며 구형 앱은 재로그인을 안내할 수 있다. 탈퇴 자체는 이미 완료된 상태다. 실제 구형 화면 복구는 미검증이다.

## 격리 Auth 실행 설계와 보류 이유

storage_audit와 조율했다. 감사 전체스키마 DB audit_auth_full_1792737494969는 담당자가 fixture 작성과 0335 적용 및 REST 검사를 독점 진행 중이다. 해당 DB에 Auth 서버를 붙이거나 추가 fixture를 쓰지 않았다. 공유 supabase_auth_SquareTable와 운영 Auth는 호출하지 않았다.

후속 실제 검사는 별도 audit 전용 DB와 GoTrue v2.197.0 컨테이너를 만든 뒤 진행한다. 외부 포트를 열지 않고 새 임의 JWT 키를 쓴다. SMTP·전화 provider·OAuth·hooks는 연결하지 않는다. 다른 담당자의 DB 연결 문자열이나 Auth 환경변수를 재사용하지 않는다. 이미지 기동이 auth schema migration을 실행할 수 있으므로 검사 중인 DB를 공유하지 않는다.

필수 대조군은 (1) 활성 합성 계정 /user 성공 (2) 같은 계정 ban 후 /user 거부 (3) session_id 없는 합성 구형 토큰도 ban 거부 (4) 활성 계정의 비밀번호 로그인 성공 (5) 0335 ban 뒤 동일 비밀번호 로그인 거부 (6) 세션 삭제 토큰 거부 (7) backfill 대상만 ban되고 활성 계정은 계속 성공이다. 토큰과 비밀번호는 메모리에만 두고 HTTP 상태·오류 코드·합성 케이스명만 저장한다. /user 검사는 Edge 인증 관문 검증이며 실제 카드·푸시 요청을 실행하지 않는다.

현재 이 HTTP 검증은 하지 않았다. 소스 검토 결과와 REST 실행 결과를 Auth HTTP 성공으로 합산하면 안 된다.
