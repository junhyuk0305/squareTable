# 로그 경로 비식별 증거 실행

저장소 루트에서 `node docs/audits/2026-10-23-codex/observability/test-route-token.cjs`로 실행한다. 수정 전 재현은 마지막 인자로 `docs/audits/2026-10-23-codex/observability/before-track.ts.txt`를 전달한다.

red.log/green.log와 수정기록.md는 당시 증거다. current-results.log는 현재 제품 소스 재실행 결과다. 7개 경로 사례에서 client_errors와 app_events 각각을 검사하여 총 14개 route 계약이 통과했다. 별도로 전송 거절이 외부 예외를 만들지 않음을 확인했다. 14개의 독립 시나리오로 세지 않는다. 실제 모듈을 실행하고 전송만 모의했으며 실제 기록은 보내지 않았다.

제품 수정은 이미 다른 세션의 커밋 d59735ffda5cb5e8dfdb5eb253aac266a5f744af에 포함됐다. 이번 폴더 추가는 제품 재수정이 아닌 증거 보존이다. 스크립트 repo 경로는 상대화했다. SYNTHETIC으로 표시된 토큰은 검사 전용 합성 값이다.
