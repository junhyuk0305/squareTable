---
name: service-knowledge
description: Squaretable 기능의 현재 코드 근거와 변경 영향을 조회하고 개편 요구, 작업, 검증 기록을 연결한다. 기능 변경 요청이나 신선도 확인에 사용한다.
disable-model-invocation: true
---

# 기능 조사와 변경 관리

입력: $ARGUMENTS

프로젝트 루트에서 실행한다. 사용 안내는 `docs/ai-knowledge/README.md`, 재개 상태는 `docs/ai-knowledge/STATE.md`다. 둘 다 로컬 전용이라 체크아웃에 따라 없을 수 있다. 저장소에는 `features/`·`changes/`·`baseline.json`만 있다.
제품 요구사항 정본은 `../00_핵심/문서_지도.md`가 지정한다. 이 도구의 JSON은 현재 코드 관찰이며 올바른 요구사항을 뜻하지 않는다.

## 조사

1. `node scripts/service-knowledge.mjs check`로 HEAD, 작업 폴더, 미커밋 내용과 기록의 차이를 본다. 종료 코드 2는 재검토 필요다. 통과로 보고하지 않는다.
2. `node scripts/service-knowledge.mjs query "사용자 표현" recipient`처럼 조회한다. 종류는 `recipient`, `field`, `contract`, `copy`, 불명확하면 `unknown`이다. 인자를 셸에 그대로 조합하지 말고 셸에 맞춰 인용한다.
3. 결과의 파일과 symbol을 실제로 읽는다. SQL은 같은 함수의 모든 정의와 이후 ALTER/GRANT/DROP을 찾아 마지막 유효 정의를 확인한다. `discover "이름"`은 주석과 과거 정의도 포함하는 후보 검색이다.
4. 검색이 비거나 새 파일이 있으면 실제 코드를 조사한다. 연결 없음은 영향 없음이 아니다. 공유 테이블만으로 다른 기능 전체를 수정 대상으로 만들지 않는다. 필드 근거가 없으면 범위를 좁혔다고 말하지 않는다.

## 요구와 작업

현재 구현, 확정 요구사항, 실행 검증을 분리한다. 미확정 제품 동작은 질문하고 그와 독립적인 조사는 계속한다.
`docs/ai-knowledge/changes/`의 해당 변경 파일 하나에 이유, 요구사항 출처와 승인 상태, 코드 대상, 의존 작업, 완료 기준, 검사, 미확인 사항을 연결한다. 기존 변경 문서가 있으면 링크하고 새 작업 목록으로 복제하지 않는다.
예시 `suggestion-recipients.json`은 미승인 연습이다. 매니저 수신을 확정한 요구로 사용하지 않는다.
단순 문구/포맷 변경은 실제 영향에 맞게 줄인다. 제품 계약 변경은 권한, 상태, 실패, 구버전 앱 및 외부 경계를 확인한다.

## 구현 후

- `impact --git`로 staged, unstaged, untracked 파일을 확인한다. 편집 도구 이벤트만 믿지 않는다.
- 기존 QA의 실행 대상을 먼저 읽는다. `npm run qa:*` 중 원격 접근 명령이 있다. 사용자 승인 없는 운영 데이터/알림 실행 금지. 설치되지 않은 명령을 안내하지 않는다.
- `verify tools`, `verify records`는 도구/기록 검사다. 제품 기능이나 실기기 검증으로 확대하지 않는다. `runs`의 sameCodeState는 같은 코드/환경인지, appliesToCurrentState는 현재에 유효한 통과 증거인지를 표시한다. 현재 상태의 실패도 별도로 남는다.
- 코드 근거를 다시 읽고 영향받은 feature만 수정한다. 사용자 결정과 진행 작업을 자동 재생성하지 않는다. 새 기능/연결은 `discover --save`로 후보를 확인한다.
- 검사 오류를 해결한 뒤 `refresh --reviewed`로 근거 시점을 갱신한다. 이것은 실행 검증이 아니다. 마지막으로 `check`, 필요한 검사를 돌리고, `STATE.md`가 있으면 갱신한다.
- 완료 보고는 도구 구축, 서비스 분석 깊이, Claude 통합을 별개로 판정한다. 제품 화면 변경은 기존 Android/iOS 실기기 절차를 따른다.

기존 `/plan-eng-review`, `/qa`, `/review`는 이 머신에 있지만 필수 의존성은 아니다. 플랫폼 정책/구현을 바꾸면 기존 프로젝트 `/platform-split`과 해당 규칙을 읽는다. 이 스킬은 배포나 제품 변경 승인 권한을 추가하지 않는다.
