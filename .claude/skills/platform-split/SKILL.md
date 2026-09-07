---
name: platform-split
description: 웹·Android·iOS에서 의도적으로 다르게 동작해야 하는 기능(결제 채널·약관 조항·소셜 로그인·스토어 규정 대응 등)을 설계·구현·등록하는 절차. "정책 차이"와 "구현 차이"를 먼저 가르고, 판정은 store-policy.ts 한 곳·구현은 확장자 쌍으로 두고, 서버 필드·법률 문서·예외표·게이트까지 한 작업에서 닫는다. 트리거 — "웹이랑 앱 다르게", "iOS만", "안드로이드만", "앱에서는 숨겨", "인앱결제 붙여", "플랫폼별로", "스토어 정책 때문에", "/platform-split".
---

# 플랫폼 분기 설계·구현 (platform-split)

이 스킬은 **의도한** 차이를 만드는 절차다. 의도하지 않은 차이(웹은 되는데 앱은 깨짐)는
`/native-audit`가 담당한다. 규칙 원문은 `.claude/rules/platform.md`, 현황 SSOT는
`00_핵심/플랫폼_배포현황_LIVE.md`.

## 0. 먼저 이름 붙인다 — 정책인가 구현인가

| 물음 | 정책 차이 | 구현 차이 |
|---|---|---|
| 왜 갈리나 | 스토어 규정·법·사업 판단 | 플랫폼 API가 다름 |
| 예 | 결제 채널(웹 PG / 앱 IAP / 없음), 소셜 로그인 노출, 약관 조항 | 파일 선택, 저장소, 푸시, IAP SDK 호출 |
| 어디에 | `src/lib/config/store-policy.ts` 상수 | 확장자 쌍(`.web`/`.ios`/`.android`/`.native`) |
| 화면은 | 상수만 읽는다 | 조각 컴포넌트를 import할 뿐 |

하나의 기능이 둘 다일 수 있다(결제 = 채널 선택은 정책, SDK 호출은 구현). 그러면 둘 다 만든다.
**판정 상수 없이 확장자 쌍만 만들면**, 나중에 "iOS만 IAP로" 같은 정책 변경 때 쌍 파일을 다시 뜯게 된다.

## 1. 정책 차이 만들기

1. `store-policy.ts`에 상수 추가. 이름은 이유로(`SHOW_*`, `*_CHANNEL`). 값이 셋 이상이면 union 문자열.
2. 상수 위 주석에 **근거**(규정 조항·결정 날짜·메모리 링크)를 쓴다. 이 파일은 "왜"의 기록이기도 하다.
3. 운영 스위치(`freeMode` 같은 서버 값)와 합쳐야 하면 `showPaymentSurface()`처럼 **함수 하나**로 합친다. 화면마다 `&&`를 새로 쓰지 않는다.
4. 화면·컴포넌트는 상수/함수만 import. `Platform.OS`로 같은 판정을 다시 쓰면 2곳 복제다.

## 2. 구현 차이 만들기

1. 달라지는 **조각**을 정한다. 화면 전체가 아니라 섹션 컴포넌트(`PaymentSection.tsx`) 또는 lib 모듈(`src/lib/iap/purchase.ts`).
2. **기본 파일 = 다수판**을 먼저 쓴다. 예외판을 확장자로 붙인다. 지금 관례는 기본=네이티브, `.web`=웹.
   Android·iOS가 갈리면 `.ios.ts(x)` 또는 `.android.ts(x)` 하나 더. Metro 해석: `.ios`/`.android` → `.native` → `.web` → 기본.
3. 두 판의 **export 시그니처를 같게** 둔다. 호출처는 어느 판이 붙는지 몰라야 한다.
4. 네이티브 전용 모듈(SDK)은 웹판에서 정적 import 금지. 웹판은 no-op 또는 동적 import.
5. 한 플랫폼에서 아예 없는 기능이면 조기 return + `// 네이티브는 추후 ○○` 주석. 무음 no-op 금지.

## 3. 코드 밖 세 군데

- **서버.** 플랫폼별로 서버 동작이 갈리면 클라가 필드로 보낸다(`provider`, `platform`). 서버는 추측하지 않는다. 필드는 선택값(옛 앱 호환).
- **법률 문서.** `scripts/legal-content.mjs` 정본 하나에 플랫폼 조항 병기. 앱 화면(`privacy.tsx` 등)은 요약+링크 유지. 약관 버전 상수(`business.ts` `TERMS_VERSION`)를 같이 올린다.
- **문구.** 네이티브에 가격·결제 유도 문구가 새면 심사 거부다. `native:gate`의 `PAY_TOKENS`가 그걸 grep한다 — 정책 상수를 바꾸면(예: IAP 도입) 게이트 기준도 같은 작업에서 바꾼다.

## 4. 등록 — 같은 커밋에서

1. `00_핵심/플랫폼_배포현황_LIVE.md` §2 예외표에 행 추가(정책 상수는 §2-1 표). 기능 차이가 아닌 표현 차이면 등록 없음.
2. `npm run platform:status -- --update-baseline` — 새 분기 파일을 baseline에 확정.
3. `npm run native:preflight -- --skip-bundle` — 확장자 쌍의 기본 파일 존재·웹 API 누출 검사. 빌드 전엔 `--skip-bundle` 없이.

## 5. 검증 순서

웹판 먼저(main 즉시 반영·Playwright로 검증 가능) → 네이티브판은 dev client(`npm run device`)에서 확인 → 빌드 전 `/native-audit` 절차 A.

## 관련 스킬·게이트 역할표

| 단계 | 담당 | 무엇을 |
|---|---|---|
| 설계·구현·등록 | **`/platform-split`** (이 스킬) | 정책/구현 가르기, 상수·쌍 배치, 서버 필드, 문서, 예외표 |
| 의도하지 않은 차이 검출 | `/native-audit` | KAV·inset·Modal·애니·층 갈림길 스캔, 실기기 제보 루프 |
| 정적 게이트 | `npm run native:preflight` | 웹 API 래칫·확장자 쌍 기본 파일·Android/iOS 번들 |
| 심사 표면 게이트 | `npm run native:gate` | 결제 문구 누출·EAS env·태그 기준 재빌드 판정 |
| 현황 | `npm run platform:status` | 플랫폼별 밀린 커밋·새 분기 파일 경고 |
| 기능 검증 | `/qa` · `/review` | 웹 브라우저 QA, 구현 직후 버그 검출 |
| 배포 | `/ship` · `배포_런북_2026-08-24.md` | 웹은 main 머지, 네이티브는 빌드+태그 |

## 보고 형식

```
## 플랫폼 분기 (YYYY-MM-DD) — <기능>
정책: <상수명> = 웹 … / Android … / iOS … (근거: …)
구현: <기본 파일> ↔ <확장자 쌍> (조각 단위)
서버: <필드> | 문서: <조항> | 게이트: <바꾼 것>
등록: 예외표 §2 행 ✅ · baseline ✅ · preflight ✅
검증: 웹 ✅ / dev client ⬜ / 실기기 ⬜
```
