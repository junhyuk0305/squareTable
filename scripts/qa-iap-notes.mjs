#!/usr/bin/env node
// qa-iap-notes.mjs — 이용권 패널 안내 문구 판정(src/lib/iap/notes.ts · errors.ts) 순수 함수 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 결함 3개(마스터 계획 P3-4):
//   Q8   아이폰에서 산 구독을 안드에서 "지금 구독"으로 봤다. 늘리기 버튼이 열리고(두 번 청구),
//        해지 버튼은 그 구독이 없는 Play 창을 열었다. 반대도 같다.
//        → otherStoreNote(subPlatform, entStore, os). 다른 기기에서 산 것이면 구매·관리 버튼을 잠그고 안내한다.
//        문구는 두 OS 공통 "다른 기기"(Apple 2.3.10 — 앱 안에서 다른 모바일 플랫폼 이름을 쓰지 않는다).
//   A-10 같은 스토어 계정의 이용권을 다른 앱 계정이 쓰고 있으면 일반 실패 문구만 떴다.
//        → iapErrorKind(e): RC 코드 "7"·"13" = in_use, "6" = already_owned. iapErrorText(kind, os).
//   Q30  다른 경로로 자동 갱신 중인 사장에게 "그 뒤에 여기서 이어가실 수 있어요"가 떴다(실제로는 자동 청구).
//        → otherPaidNote(plan, paidUntil, renewsElsewhere, now). 문구는 "…이후에도 자동으로 이어져요."까지만(정책 L3).
// 실행: node scripts/qa-iap-notes.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);

let notes = {};
let errors = {};
try {
  notes = await import('../src/lib/iap/notes.ts');
} catch (e) {
  console.log('  FAIL notes 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}
try {
  errors = await import('../src/lib/iap/errors.ts');
} catch (e) {
  console.log('  FAIL errors 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}
const { otherStoreNote, otherPaidNote } = notes;
const { iapErrorKind, iapErrorText } = errors;
const fn = (f) => typeof f === 'function';
const call = (f, ...a) => (fn(f) ? f(...a) : '(함수 없음)');

const STORE_NOTE = '이 이용권은 다른 기기에서 산 거예요. 매장 수 바꾸기와 해지는 산 기기에서 해 주세요.';
const PLATFORM_NAMES = /안드로이드|아이폰|Android|iPhone|iOS|Google|Apple|Play|App Store/;
const CHANNEL_WORDS = /카드|웹|토스/;

console.log('\n■ Q8 — 다른 기기에서 산 이용권은 이 기기에서 바꾸거나 해지하지 못한다');
{
  const r = call(otherStoreNote, 'appstore', null, 'android');
  check('★아이폰에서 산 구독(서버 행 appstore)을 안드에서 연다 → 막고 안내', r === STORE_NOTE, show(r));
}
{
  const r = call(otherStoreNote, 'play', null, 'ios');
  check('★안드에서 산 구독(서버 행 play)을 아이폰에서 연다 → 막고 안내', r === STORE_NOTE, show(r));
}
{
  const r = call(otherStoreNote, 'play', null, 'android');
  check('안드에서 산 구독을 안드에서 연다 → 안내 없음', r === null, show(r));
}
{
  const r = call(otherStoreNote, 'appstore', null, 'ios');
  check('아이폰에서 산 구독을 아이폰에서 연다 → 안내 없음', r === null, show(r));
}
{
  const r = call(otherStoreNote, null, 'APP_STORE', 'android');
  check('★서버 행 없음(웹훅 늦음) + 스토어 권한 APP_STORE + 안드 → 막고 안내', r === STORE_NOTE, show(r));
}
{
  const r = call(otherStoreNote, null, 'PLAY_STORE', 'ios');
  check('서버 행 없음 + 스토어 권한 PLAY_STORE + 아이폰 → 막고 안내', r === STORE_NOTE, show(r));
}
{
  const r = call(otherStoreNote, null, 'PLAY_STORE', 'android');
  check('서버 행 없음 + 같은 스토어 권한 → 안내 없음', r === null, show(r));
}
{
  const r = call(otherStoreNote, 'play', 'APP_STORE', 'android');
  check('서버 행이 있으면 서버 행이 먼저다(스토어 권한은 2차 판정)', r === null, show(r));
}
{
  const r = call(otherStoreNote, null, null, 'android');
  check('구독 없음 → 안내 없음', r === null, show(r));
}
{
  const r = call(otherStoreNote, null, 'PROMOTIONAL', 'android');
  check('모르는 스토어 값은 막지 않는다', r === null, show(r));
}
{
  const r = call(otherStoreNote, 'appstore', null, 'web');
  check('웹은 해당 없음', r === null, show(r));
}
check('Q8 문구에 플랫폼 이름이 없다(Apple 2.3.10)', !PLATFORM_NAMES.test(STORE_NOTE) && !CHANNEL_WORDS.test(STORE_NOTE));
// 2026-10-05 결정: 언제부터 이 기기에서 결제할 수 있는지(그 구독의 current_period_end · 한국 날짜)를 붙인다.
{
  const now = new Date('2026-10-05T03:00:00Z').getTime();
  const end = '2026-10-15T15:30:00Z';   // KST 10월 16일 00:30
  const r = call(otherStoreNote, 'appstore', null, 'android', end, now);
  const want = `${STORE_NOTE} 이용 기간(10월 16일)이 끝나면 이 기기에서 결제할 수 있어요.`;
  check('★기간 끝 날짜(KST)를 붙인다', r === want, show(r));
  check('★날짜 붙인 문구에도 플랫폼·채널 말이 없다', typeof r === 'string' && !PLATFORM_NAMES.test(r) && !/카드|웹에서|토스|계좌이체/.test(r), show(r));
  const gone = call(otherStoreNote, 'appstore', null, 'android', '2026-10-01T00:00:00Z', now);
  check('★기간이 끝난 구독은 잠그지 않는다', gone === null, show(gone));
  const y = call(otherStoreNote, 'play', null, 'ios', '2027-01-10T03:00:00Z', now);
  check('해를 넘기면 연도를 붙인다', typeof y === 'string' && y.includes('이용 기간(2027년 1월 10일)'), show(y));
  const nd = call(otherStoreNote, null, 'APP_STORE', 'android', null, now);
  check('날짜를 모르면(서버 행 없음) 날짜 문장 없이 잠근다', nd === STORE_NOTE, show(nd));
}
{
  const panel = readFileSync(new URL('../src/components/IapPurchasePanel.tsx', import.meta.url), 'utf8');
  check('패널이 current_period_end 를 넘긴다', /otherStoreNote\(sub\?\.platform, entStore, Platform\.OS, sub\?\.current_period_end\)/.test(panel));
}

console.log('\n■ A-10 — 다른 앱 계정이 쓰는 이용권 안내');
{
  const a = call(iapErrorKind, { code: '7' });
  const b = call(iapErrorKind, { code: '13' });
  const c = call(iapErrorKind, { code: '6' });
  check('★RC "7"(RECEIPT_ALREADY_IN_USE) → in_use', a === 'in_use', show(a));
  check('★RC "13"(RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER) → in_use', b === 'in_use', show(b));
  check('★RC "6"(PRODUCT_ALREADY_PURCHASED) → already_owned', c === 'already_owned', show(c));
}
{
  const r = [
    call(iapErrorKind, { code: '1' }),
    call(iapErrorKind, { code: '2' }),
    call(iapErrorKind, null),
    call(iapErrorKind, undefined),
    call(iapErrorKind, new Error('x')),
    call(iapErrorKind, 'oops'),
  ];
  check('다른 코드·형태가 아닌 값 → other', r.every((k) => k === 'other'), show(r));
}
{
  const ios = call(iapErrorText, 'in_use', 'ios');
  const and = call(iapErrorText, 'in_use', 'android');
  check(
    '아이폰 in_use 문구',
    ios === '이 Apple ID의 이용권은 다른 매장의 정석 계정에서 쓰고 있어요. 그 계정으로 로그인해 주세요.',
    show(ios),
  );
  check(
    '안드 in_use 문구',
    and === '이 Google 계정의 이용권은 다른 매장의 정석 계정에서 쓰고 있어요. 그 계정으로 로그인해 주세요.',
    show(and),
  );
  check('아이폰 문구에 다른 플랫폼 이름이 없다', fn(iapErrorText) && typeof ios === 'string' && !/Google|안드로이드|Android/.test(ios));
  check('안드 문구에 다른 플랫폼 이름이 없다', fn(iapErrorText) && typeof and === 'string' && !/Apple|아이폰|iPhone/.test(and));
}
{
  const want = '이미 구독 중인 이용권이 있어요. 다른 매장의 정석 계정에서 쓰고 있을 수 있어요.';
  const a = call(iapErrorText, 'already_owned', 'ios');
  const b = call(iapErrorText, 'already_owned', 'android');
  check('already_owned 문구(두 OS 같음)', a === want && b === want, show([a, b]));
}
{
  const r = call(iapErrorText, 'other', 'ios');
  check('other → null(화면의 일반 문구를 쓴다)', r === null, show(r));
}

console.log('\n■ Q30 — 다른 경로로 자동 갱신 중이면 "여기서 이어가요"라고 말하지 않는다');
const NOW = new Date('2026-10-05T12:00:00+09:00').getTime();
const UNTIL = '2026-10-30T12:00:00+09:00';
{
  const r = call(otherPaidNote, 'single', UNTIL, true, NOW);
  check('★자동 갱신 중 → "…이후에도 자동으로 이어져요."까지만', r === '지금 이용권은 10월 30일 이후에도 자동으로 이어져요.', show(r));
  check('자동 갱신 문구에 "여기서"가 없다(정책 L3)', fn(otherPaidNote) && typeof r === 'string' && !r.includes('여기서'), show(r));
  check('자동 갱신 문구에 채널 말이 없다(3.1.1)', fn(otherPaidNote) && typeof r === 'string' && !CHANNEL_WORDS.test(r), show(r));
}
{
  const r = call(otherPaidNote, 'single', UNTIL, false, NOW);
  check('자동 갱신 아님 → 지금 문구 그대로', r === '10월 30일까지 이용 기간이 남아 있어요. 그 뒤에 여기서 이어가실 수 있어요.', show(r));
}
{
  const r = call(otherPaidNote, 'multi', '2027-01-05T12:00:00+09:00', true, NOW);
  check('해를 넘기면 연도를 붙인다', r === '지금 이용권은 2027년 1월 5일 이후에도 자동으로 이어져요.', show(r));
}
{
  const r = [
    call(otherPaidNote, 'free', UNTIL, true, NOW),
    call(otherPaidNote, 'single', null, true, NOW),
    call(otherPaidNote, 'single', '2026-10-01T12:00:00+09:00', true, NOW),
    call(otherPaidNote, 'single', '2026-10-01T12:00:00+09:00', false, NOW),
    call(otherPaidNote, 'single', 'not-a-date', false, NOW),
  ];
  check('무료·기간 없음·기간 지남·날짜 오류 → null(구매 차단 조건은 그대로)', r.every((x) => x === null), show(r));
}

console.log('\n■ 3.1.1 — 앱 구매 화면 문구에 다른 결제 채널 말이 없다');
{
  // 주석을 걷어 낸 코드만 본다. 화면 문구·문자열에 "카드"·"웹에서"·"토스"가 있으면 안 된다.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const p of ['src/components/IapPurchasePanel.tsx', 'src/lib/iap/notes.ts', 'src/lib/iap/errors.ts']) {
    let src = '';
    try {
      src = strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
    } catch (e) {
      check(`${p} 를 읽는다`, false, String(e && e.code ? e.code : e));
      continue;
    }
    const hit = src.match(/카드|웹에서|토스/);
    check(`${p} 코드에 채널 말이 없다`, !hit, hit ? show(hit[0]) : '');
  }
}

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
