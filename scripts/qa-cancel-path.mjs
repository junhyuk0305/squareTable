#!/usr/bin/env node
// qa-cancel-path.mjs — 구독 해지 경로 문구(src/lib/iap/cancelPath.ts) 순수 함수 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 결함 N-1(마스터 계획 P3-5): 안드 앱의 해지 안내가 iOS 문구("기기 설정의 구독 목록")였다.
//   안드 사장은 기기 설정에서 구독을 찾지 못한다. 해지는 Play 스토어 앱에서 한다.
//   네 곳이 같은 문구를 따로 적고 있었다: IapPurchasePanel 토스트·자동갱신 고지, 탈퇴 확인창, 약관 요약.
//   → cancelPathText(os) 하나를 store-policy 의 CANCEL_PATH_TEXT 로 내보내고 네 곳이 그 값을 쓴다.
// ⛔토스 심사 동결(~10-16): 웹 문구는 글자 하나까지 그대로다(/terms).
// 실행: node scripts/qa-cancel-path.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);

let cancelPathText = null;
try {
  ({ cancelPathText } = await import('../src/lib/iap/cancelPath.ts'));
} catch (e) {
  console.log('  FAIL 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}
const text = (os) => (typeof cancelPathText === 'function' ? cancelPathText(os) : null);

const OLD = '기기 설정의 구독 목록';
const ANDROID = 'Play 스토어 앱의 결제 및 정기 결제 > 정기 결제';

console.log('\n■ N-1 — OS별 해지 경로');
{
  const r = text('android');
  check("★cancelPathText('android') 에 'Play' 가 있다", typeof r === 'string' && r.includes('Play'), show(r));
  check('안드 문구 = 설계 문구', r === ANDROID, show(r));
  check('안드 문구에 기기 설정 경로가 없다', typeof r === 'string' && !r.includes('기기 설정'), show(r));
}
{
  const r = text('ios');
  check('iOS 문구 = 지금 문구 그대로', r === OLD, show(r));
  check('iOS 문구에 다른 플랫폼 이름이 없다(Apple 2.3.10)', typeof r === 'string' && !/Play|Google|안드로이드|Android/.test(r), show(r));
}
{
  const r = text('web');
  check('★웹 문구 = 지금 문구 그대로(토스 동결)', r === OLD, show(r));
}
{
  const all = ['ios', 'android', 'web'].map(text);
  check('세 문구 모두 채널 말이 없다(3.1.1)', all.every((s) => typeof s === 'string' && !/카드|웹에서|토스/.test(s)), show(all));
}

console.log('\n■ 네 곳이 CANCEL_PATH_TEXT 를 쓰고, 웹에서는 지금 문장이 그대로 나온다');
// 주석을 걷어 낸 코드만 본다.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (p) => {
  try {
    return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  } catch (e) {
    check(`${p} 를 읽는다`, false, String(e && e.code ? e.code : e));
    return '';
  }
};
{
  const src = strip(read('src/lib/config/store-policy.ts'));
  check(
    'store-policy 가 CANCEL_PATH_TEXT = cancelPathText(Platform.OS) 를 내보낸다',
    /export const CANCEL_PATH_TEXT = cancelPathText\(Platform\.OS\);/.test(src),
  );
}
// [파일, 코드 안 템플릿 조각, 지금(웹) 문장]
// 관리 창 실패 안내는 토스트가 아니라 고지창이다 — 아래 별도 블록에서 본다.
const SITES = [
  [
    'src/components/IapPurchasePanel.tsx',
    '매달 자동으로 갱신돼요. 해지하시기 전까지 계속돼요. 해지는 ${CANCEL_PATH_TEXT}에서 하실 수 있어요.',
    '매달 자동으로 갱신돼요. 해지하시기 전까지 계속돼요. 해지는 기기 설정의 구독 목록에서 하실 수 있어요.',
  ],
  [
    'src/app/terms.tsx',
    '해지하시기 전까지 갱신일마다 자동으로 결제됩니다. 해지는 ${CANCEL_PATH_TEXT}에서 언제든지 하실 수 있습니다. 회사는',
    '해지하시기 전까지 갱신일마다 자동으로 결제됩니다. 해지는 기기 설정의 구독 목록에서 언제든지 하실 수 있습니다. 회사는',
  ],
];
for (const [file, tpl, oldSentence] of SITES) {
  const src = read(file);
  const label = tpl.slice(0, 18);
  check(`${file} — "${label}…" 가 CANCEL_PATH_TEXT 를 쓴다`, src.includes(tpl));
  check(`${file} — "${label}…" 웹 값 대입 = 지금 문장`, tpl.replace('${CANCEL_PATH_TEXT}', text('web')) === oldSentence);
}
for (const file of new Set(SITES.map(([f]) => f))) {
  const src = strip(read(file));
  check(`${file} 코드에 "구독 목록" 을 직접 적지 않는다`, !src.includes('구독 목록'));
  check(`${file} 가 CANCEL_PATH_TEXT 를 store-policy 에서 읽는다`, /import \{[^}]*\bCANCEL_PATH_TEXT\b[^}]*\} from '@\/lib\/config\/store-policy'/.test(src));
}

// 탈퇴 확인창(2026-10-04 P3-8 · Q33)은 플랫폼이 아니라 실제 구독으로 가른다. 그래서 상수가 아니라
// lib/account/copy.ts 의 deleteNotice 가 cancelPathText(os) 를 직접 부른다. 문구 전체는 qa:account-ui 가 본다.
{
  const src = strip(read('src/lib/account/copy.ts'));
  check('탈퇴 확인창 이용권 안내가 cancelPathText(os) 를 쓴다(Q33 · lib/account/copy.ts)', /cancelPathText\(v\.os\)/.test(src));
  check('src/app/account-settings.tsx 코드에 "구독 목록" 을 직접 적지 않는다', !strip(read('src/app/account-settings.tsx')).includes('구독 목록'));
}

console.log('\n■ 관리 창 실패 안내는 잘리지 않는 고지창으로 띄운다');
// 토스트는 2줄에서 자르고 2.4초 뒤 사라진다(Toast.tsx numberOfLines={2} · useToastStore PLAIN_MS).
// 안드 문장은 360dp 에서 2.5줄쯤이라 "결제 > 정기 결…" 에서 잘려 마지막 메뉴가 안 보였다.
// → 같은 문장을 제목(앞 문장)과 본문(경로)으로 나눠 notifyAction 으로 띄운다. 글자는 그대로다.
{
  const src = strip(read('src/components/IapPurchasePanel.tsx'));
  const TITLE = '구독 관리 창을 열지 못했어요';
  const BODY = '`${CANCEL_PATH_TEXT}에서 하실 수 있어요.`';
  check('★관리 창 실패 안내를 토스트로 띄우지 않는다', !/showToast\([^)]*CANCEL_PATH_TEXT/.test(src));
  check(
    '★관리 창 실패 안내 = notifyAction(제목, 경로 본문)',
    src.includes(`notifyAction('${TITLE}', ${BODY}`),
  );
  check('notifyAction 을 utils/confirm 에서 읽는다', /import \{[^}]*\bnotifyAction\b[^}]*\} from '@\/lib\/utils\/confirm'/.test(src));
  const joined = `${TITLE}. ${'${CANCEL_PATH_TEXT}에서 하실 수 있어요.'.replace('${CANCEL_PATH_TEXT}', text('web'))}`;
  check(
    '제목 + 본문 웹 값 = 지금 문장(글자 그대로)',
    joined === '구독 관리 창을 열지 못했어요. 기기 설정의 구독 목록에서 하실 수 있어요.',
    show(joined),
  );
}

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 || typeof cancelPathText !== 'function' ? 1 : 0);
