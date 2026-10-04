#!/usr/bin/env node
// qa-store-copy.mjs — 매장 다시 열기 · 사장 탈퇴 막힘 · 매장 삭제 확인 문구 순수 판정 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 마스터 계획 P3-10 (서버 0235 delete_store_preview · delete_store jsonb 는 이미 이 브랜치에 있다)
//   J4 다시 열기 확인창이 "비워지는 것: 직원·근무표·출퇴근·업무 보드"라고 했다. 0235 부터 기록은 남는다.
//      → "기록(출퇴근·근무 기록·노하우·채팅)은 그대로예요. 직원은 새 초대코드로 다시 초대해요." 이용권 문장은 그대로.
//   J5 서버가 owner_has_staff 로 막으면(P7-1 뒤) 앱이 "탈퇴 처리에 실패했어요"만 보였다.
//      → 이유 문구 + [직원 관리로 가기]. 서버 차단은 아직 켜지 않는다.
//   J8 매장 삭제 확인창이 남은 이용 기간을 말하지 않았다. 돌려주지 않는 매장에 약속하면 안 된다(정책 M2).
//      → delete_store_preview.returns_slot 이 true 일 때만 기간 문장. 성공 토스트는 delete_store 반환값으로 고른다.
//   ⛔웹은 매장 삭제 확인창·토스트를 글자 그대로 둔다(토스 동결 · 보수적 판단).
// 실행: node scripts/qa-store-copy.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);
const fn = (f) => typeof f === 'function';

const load = async (p) => {
  try {
    return await import(p);
  } catch (e) {
    console.log('  FAIL 모듈을 읽지 못했다', p, String(e && e.code ? e.code : e));
    return {};
  }
};
const mod = await load('../src/lib/account/storeCopy.ts');

const read = (p) => {
  try {
    return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  } catch (e) {
    check(`${p} 를 읽는다`, false, String(e && e.code ? e.code : e));
    return '';
  }
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const STYLE = /—| · /;
const CHANNEL = /카드|웹에서|토스/;

const { REOPEN_STORE_MESSAGE, OWNER_HAS_STAFF_TEXT, deleteAccountError, deleteStoreConfirmText, deleteStoreToast } = mod;

const J4 = '기록(출퇴근·근무 기록·노하우·채팅)은 그대로예요. 직원은 새 초대코드로 다시 초대해요.';
const J5 = '직원이 있으면 탈퇴할 수 없어요. 직원 관리에서 먼저 내보내 주세요.';
const J8 = (md) => `이 매장의 이용 기간(${md}까지)은 새 매장을 만들 때 쓸 수 있어요. 이용 중인 매장 수와 요금은 그대로예요.`;
const DEL_FAIL = '탈퇴 처리에 실패했어요. 잠시 후 다시 시도해 주세요.';
// ⛔지금 확인창·토스트 문구(웹은 이대로 둔다).
const OLD_CONFIRM = (name) => `“${name}”의 노하우·근무·급여 등 모든 데이터가 영구 삭제돼요. 되돌릴 수 없어요.`;
const OLD_TOAST = '매장을 삭제했어요.';
const BACK_TOAST = '매장을 삭제했어요. 새 매장 1곳을 열 수 있어요.';

console.log('\n■ J4 — 다시 열기 확인창은 기록이 남는다고 말한다');
{
  const m = typeof REOPEN_STORE_MESSAGE === 'string' ? REOPEN_STORE_MESSAGE : '';
  check('문구가 있다', m.length > 0, show(m));
  check('이용권 문장은 그대로 맨 앞에 둔다', m.startsWith('이용권 1개를 써요.'), show(m));
  check('J4 문구가 그대로 들어 있다', m.includes(J4), show(m));
  check("'비워지는 것' 목록이 없다(출퇴근·업무 보드는 이제 남는다)", !/비워지는 것/.test(m) && !m.includes('업무 보드'), show(m));
  check('대시·문장 잇는 중간점이 없다', m.length > 0 && !STYLE.test(m), show(m));
  const src = strip(read('src/app/owner/previous-stores.tsx'));
  check('previous-stores 가 REOPEN_STORE_MESSAGE 를 쓴다', /REOPEN_STORE_MESSAGE/.test(src));
  check('previous-stores 에 옛 목록 문구가 없다', !/비워지는 것/.test(src));
}

console.log('\n■ J5 — 사장 탈퇴가 owner_has_staff 로 막히면 이유와 갈 곳을 준다');
{
  check('OWNER_HAS_STAFF_TEXT = 계획 문구', OWNER_HAS_STAFF_TEXT === J5, show(OWNER_HAS_STAFF_TEXT));
  const call = (raw) => (fn(deleteAccountError) ? deleteAccountError(raw) : null);
  const a = call('owner_has_staff');
  check('owner_has_staff → J5 문구 · 직원 관리로', a?.text === J5 && a?.toStaff === true, show(a));
  const b = call('P0001: owner_has_staff');
  check('접두어가 붙어도 같은 판정', b?.text === J5 && b?.toStaff === true, show(b));
  const c = call('some internal error');
  check('모르는 오류 → 지금 실패 문구 · 버튼 없음', c?.text === DEL_FAIL && c?.toStaff === false, show(c));
  const d = call('Failed to fetch');
  check('연결 오류 → 공통 문구 · 버튼 없음', typeof d?.text === 'string' && d.text.includes('인터넷') && d.toStaff === false, show(d));
  const store = strip(read('src/lib/store/useSessionStore.ts'));
  check('deleteAccount 가 deleteAccountError 로 고른다', /deleteAccountError\(/.test(store));
  const ui = strip(read('src/app/account-settings.tsx'));
  check("탈퇴 창에 [직원 관리로 가기] 가 있다", ui.includes("'직원 관리로 가기'"));
  check('버튼이 /owner/staff 로 간다', /\/owner\/staff/.test(ui));
}

console.log('\n■ J8 — 매장 삭제 확인창은 돌려주는 매장에만 기간 문장을 붙인다');
{
  const conf = (a) => (fn(deleteStoreConfirmText) ? deleteStoreConfirmText(a) : '(함수 없음)');
  const name = '코홀트 강남점';
  const back = { returns_slot: true, paid_until: '2026-11-15T14:59:59+00:00' };
  for (const os of ['ios', 'android']) {
    const t = conf({ storeName: name, preview: back, os });
    check(`${os} · 돌려줌 → 기간 문장(KST 11월 15일)`, t.includes(J8('11월 15일')) && t.includes(OLD_CONFIRM(name)), show(t));
  }
  const late = conf({ storeName: name, preview: { returns_slot: true, paid_until: '2026-11-15T15:30:00Z' }, os: 'ios' });
  check('UTC 15:30 은 KST 다음 날(11월 16일)', late.includes(J8('11월 16일')), show(late));
  const none = conf({ storeName: name, preview: { returns_slot: false, paid_until: null }, os: 'ios' });
  check('돌려주지 않음 → 지금 문구만', none === OLD_CONFIRM(name), show(none));
  const failed = conf({ storeName: name, preview: null, os: 'android' });
  check('미리보기를 못 읽음(null) → 약속하지 않는다', failed === OLD_CONFIRM(name), show(failed));
  const noDate = conf({ storeName: name, preview: { returns_slot: true, paid_until: null }, os: 'ios' });
  check('날짜가 없으면 약속하지 않는다', noDate === OLD_CONFIRM(name), show(noDate));
  const web = conf({ storeName: name, preview: back, os: 'web' });
  check('⛔웹은 지금 문구 그대로(동결)', web === OLD_CONFIRM(name), show(web));
  const t = conf({ storeName: name, preview: back, os: 'ios' });
  check('대시·문장 잇는 중간점·결제 채널 말이 없다', !STYLE.test(t) && !CHANNEL.test(t), show(t));
}

console.log('\n■ J8 — 성공 토스트는 delete_store 반환값으로 고른다');
{
  const toast = (a) => (fn(deleteStoreToast) ? deleteStoreToast(a) : '(함수 없음)');
  check('iOS · returned_slot true → 새 매장 문장', toast({ result: { returned_slot: true, paid_until: '2026-11-15T14:59:59Z' }, os: 'ios' }) === BACK_TOAST);
  check('안드 · returned_slot true → 새 매장 문장', toast({ result: { returned_slot: true, paid_until: '2026-11-15T14:59:59Z' }, os: 'android' }) === BACK_TOAST);
  check('returned_slot false → 지금 토스트', toast({ result: { returned_slot: false, paid_until: null }, os: 'ios' }) === OLD_TOAST);
  check('반환값 없음(옛 서버 void) → 지금 토스트', toast({ result: null, os: 'android' }) === OLD_TOAST);
  check('⛔웹은 지금 토스트 그대로', toast({ result: { returned_slot: true, paid_until: null }, os: 'web' }) === OLD_TOAST);
}

console.log('\n■ 연결 — 데이터 계층과 화면');
{
  const db = strip(read('src/lib/db.ts'));
  check("db.ts 가 delete_store_preview 를 부른다", /rpc\('delete_store_preview'/.test(db));
  check('rpcDeleteStore 가 반환값(data)을 돌려준다', /rpcDeleteStore[\s\S]{0,400}?return \{\s*data/.test(db));
  const cfg = strip(read('src/app/owner/store-config.tsx'));
  check('store-config 가 deleteStoreConfirmText 를 쓴다', /deleteStoreConfirmText\(/.test(cfg));
  check('store-config 가 deleteStoreToast 를 쓴다', /deleteStoreToast\(/.test(cfg));
  check('store-config 가 웹에서는 미리보기를 부르지 않는다', /Platform\.OS !== 'web'[\s\S]{0,200}?fetchDeleteStorePreview/.test(cfg));
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
