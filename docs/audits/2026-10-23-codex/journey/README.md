# 알림 복귀 증거 실행

저장소 루트에서 `node docs/audits/2026-10-23-codex/journey/test-push-recovery.cjs`로 실행한다. 수정 전 재현은 마지막 인자로 `docs/audits/2026-10-23-codex/journey/nativepush.before.ts.txt`를 전달한다.

red.json/green.json 및 수정결과.md는 당시 증거다. current-results.log는 복사 위치에서 현재 제품 소스로 재실행한 결과이며 Android/iOS 각 17개, 총 34개 계약이 통과했다. Expo 및 세션과 라우터 API는 모의했다. 실제 기기 실행이 아니다.

제품 수정은 이미 다른 세션의 커밋 d59735ffda5cb5e8dfdb5eb253aac266a5f744af에 포함됐다. 이번 폴더 추가는 제품 재수정이 아닌 증거 보존이다. 스크립트 repo 경로는 상대화했다. 결과의 로컬 사용자 경로만 <repo>/<original-evidence>로 치환했다. 원본은 외부 산출물에 보존했다.
