#!/usr/bin/env node
// qa-consent-ui.mjs — 가입 동의 체크리스트 · 만 14세 판정 · 동의 전송(앱 쪽) 순수 판정 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 마스터 계획 P3-9 (J12 · 서버 0240 은 이미 이 브랜치에 있다 — 서버 쪽 검증은 qa:consents)
//   ① 동의를 화면 상태로만 들고 서버에 보내지 않았다 → signUp 메타에 consents · consent_version(TERMS_VERSION).
//   ② 앱 키가 'collect' 였다. 서버 허용 목록(0240)은 'privacy_collect' 다 → 그대로 보내면 그 항목이 조용히 버려진다.
//   ③ 구글 가입(프로필 완성)에는 동의 칸이 없었다 → 필수 동의 + record_my_consents('google_signup').
//   ④ 만 14세 미만을 앱이 거르지 않았다 → isUnder14(KST) · 서버 under_14 오류를 문구로 바꾼다.
//   ⑤ 저장도 사용도 안 하는 마케팅 동의 행 → 뺀다. 직원 문구 "(미성년자는 법정대리인 동의 필요)" → "만 14세 이상입니다".
// 실행: node scripts/qa-consent-ui.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
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
    fail++;
    return {};
  }
};
const consent = await load('../src/lib/config/consent.ts');
const { isUnder14 } = await load('../src/lib/utils/validation.ts');
const { TERMS_VERSION } = await load('../src/lib/config/business.ts');
const { isMissingRpc } = await load('../src/lib/utils/userError.ts');

const read = (p) => {
  try {
    return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  } catch (e) {
    check(`${p} 를 읽는다`, false, String(e && e.code ? e.code : e));
    return '';
  }
};
// 주석을 걷어 낸 코드만 본다.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SERVER_ITEMS = ['age14', 'terms', 'privacy_collect', 'labor']; // 0240 허용 목록
const SERVER_VERSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[A-Za-z0-9._-]{0,10}$/; // 0240 버전 형식
const STYLE = /—| · /;
const { consentRows, consentPayload, allConsented, UNDER_14_TEXT } = consent;
const rows = (r) => (fn(consentRows) ? consentRows(r) : []);
const keys = (r) => rows(r).map((x) => x.key);

console.log('\n■ 체크리스트 정본(consent.ts) — 서버 키 · 마케팅 없음 · 직원 14세 문구');
{
  check('사장 = age14 · terms · privacy_collect', show(keys('owner')) === show(['age14', 'terms', 'privacy_collect']), show(keys('owner')));
  check('직원 = 사장 + labor', show(keys('junior')) === show(['age14', 'terms', 'privacy_collect', 'labor']), show(keys('junior')));
  const all = [...keys('owner'), ...keys('junior')];
  check('★모든 키가 서버 허용 목록 안이다(collect 가 아니라 privacy_collect)', all.length > 0 && all.every((k) => SERVER_ITEMS.includes(k)), show(all));
  check('마케팅 행이 없다', !all.includes('marketing') && !rows('owner').concat(rows('junior')).some((r) => /마케팅/.test(r.label ?? '')));
  const age = (r) => rows(r).find((x) => x.key === 'age14')?.label;
  check('★직원 14세 문구 = "만 14세 이상입니다"(법정대리인 문구 없음)', age('junior') === '만 14세 이상입니다', show(age('junior')));
  check('사장 14세 문구 = "만 14세 이상입니다"', age('owner') === '만 14세 이상입니다', show(age('owner')));
  const docOf = (k) => rows('junior').find((x) => x.key === k)?.doc;
  check('문서 링크 = /terms · /legal/collect · /legal/labor (문서 경로는 그대로)', docOf('terms') === '/terms' && docOf('privacy_collect') === '/legal/collect' && docOf('labor') === '/legal/labor', show(rows('junior')));
  check('문구에 대시·중간점 잇기가 없다', rows('junior').every((r) => !STYLE.test(r.label ?? '')));
}

console.log('\n■ 동의 판정 · 전송값');
{
  const none = {};
  const ownerAll = { age14: true, terms: true, privacy_collect: true };
  const staffAll = { ...ownerAll, labor: true };
  check('allConsented: 하나도 없으면 false', fn(allConsented) && allConsented('owner', none) === false);
  check('allConsented: 사장 3개면 true', fn(allConsented) && allConsented('owner', ownerAll) === true);
  check('allConsented: 직원은 labor 까지 있어야 true', fn(allConsented) && allConsented('junior', ownerAll) === false && allConsented('junior', staffAll) === true);
  const p = fn(consentPayload) ? consentPayload('junior', staffAll) : null;
  check('★consentPayload(직원) = 키 4개 + consent_version = TERMS_VERSION', !!p && show(p.consents) === show(['age14', 'terms', 'privacy_collect', 'labor']) && p.consent_version === TERMS_VERSION, show(p));
  const po = fn(consentPayload) ? consentPayload('owner', { ...staffAll, marketing: true, collect: true }) : null;
  check('consentPayload(사장)은 화면 행에 없는 키를 싣지 않는다', !!po && show(po.consents) === show(['age14', 'terms', 'privacy_collect']), show(po));
  check('TERMS_VERSION 이 서버 버전 형식(0240)을 통과한다', SERVER_VERSION.test(String(TERMS_VERSION)), show(TERMS_VERSION));
  check('UNDER_14_TEXT = "만 14세 미만은 가입할 수 없어요."', UNDER_14_TEXT === '만 14세 미만은 가입할 수 없어요.', show(UNDER_14_TEXT));
}

console.log('\n■ isUnder14 — KST 오늘 기준 · 서버 ensure_birth_date(0240)와 같은 경계');
{
  const u = (b, t) => (fn(isUnder14) ? isUnder14(b, t) : '(함수 없음)');
  check('오늘이 만 14세 생일이면 통과(2012-10-05 @ 2026-10-05)', u('2012-10-05', '2026-10-05') === false, show(u('2012-10-05', '2026-10-05')));
  check('하루 모자라면 막는다(2012-10-06 @ 2026-10-05)', u('2012-10-06', '2026-10-05') === true, show(u('2012-10-06', '2026-10-05')));
  check('2013-12-01 은 막는다', u('2013-12-01', '2026-10-05') === true);
  check('1990-01-31 은 통과', u('1990-01-31', '2026-10-05') === false);
  check('2/29 생 · 평년 2/28 은 아직 14세 아님(서버: 2026-02-28 - 14y = 2012-02-28)', u('2012-02-29', '2026-02-28') === true, show(u('2012-02-29', '2026-02-28')));
  check('2/29 생 · 평년 3/1 은 통과', u('2012-02-29', '2026-03-01') === false);
  check('윤년 2/29 오늘 · 14년 전은 2/28 로 맞춘다(2010-02-28 통과 · 2010-03-01 막음)', u('2010-02-28', '2024-02-29') === false && u('2010-03-01', '2024-02-29') === true);
  check('오늘을 안 넘기면 KST 오늘을 쓴다(먼 과거 통과 · 어제 막음)', u('1990-01-31') === false && u(new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10)) === true);
}

console.log('\n■ 화면·세션 연결(주석 제외 코드)');
{
  const signup = strip(read('src/app/signup.tsx'));
  const cp = strip(read('src/app/complete-profile.tsx'));
  const store = strip(read('src/lib/store/useSessionStore.ts'));
  const db = strip(read('src/lib/db.ts'));
  const checklist = strip(read('src/components/ConsentChecklist.tsx'));
  check('가입 화면은 정본 체크리스트를 쓴다(자체 행 정의 없음)', /ConsentChecklist/.test(signup) && !/consentRows\s*:/.test(signup) && !/'marketing'|'collect'/.test(signup));
  check('★가입 화면이 signUp 메타에 consentPayload 를 싣는다', /consentPayload\(/.test(signup) && /signUp\(/.test(signup));
  check('가입 화면이 isUnder14 로 막는다', /isUnder14\(/.test(signup) && /UNDER_14_TEXT/.test(signup));
  check('signUp 메타 타입에 consents · consent_version 이 있다', /consents\??:\s*ConsentKey\[\]/.test(store) && /consent_version\??:\s*string/.test(store));
  check('프로필 완성 화면에 체크리스트 · 14세 검사가 있다', /ConsentChecklist/.test(cp) && /isUnder14\(/.test(cp) && /allConsented\(/.test(cp));
  check('★프로필 완성이 동의를 completeProfile 로 넘긴다', /completeProfile\((?:(?!completeProfile\().)*consentPayload\(/.test(cp.replace(/\s+/g, ' ')));
  check("★세션 completeProfile 이 record_my_consents('google_signup') 을 먼저 부른다", /rpcRecordMyConsents\([^)]*'google_signup'\)/.test(store.replace(/\s+/g, ' ')));
  check('db.ts 에 record_my_consents 래퍼(p_items · p_version · p_channel)', /rpc\('record_my_consents',\s*\{\s*p_items[^}]*p_version[^}]*p_channel/.test(db.replace(/\s+/g, ' ')));
  const n = (store.match(/under_14/g) || []).length;
  check('★under_14 를 completeProfile · createStore · joinByInvite 세 곳에서 문구로 바꾼다', n >= 3 && (store.match(/UNDER_14_TEXT/g) || []).length >= 3, `under_14 ${n}회`);
  check('체크리스트 컴포넌트는 consent.ts 의 행을 그린다', /consentRows\(/.test(checklist) && /allConsented\(/.test(checklist));
}

console.log('\n■ 서버에 0240 이 아직 없을 때 — record_my_consents 부재는 가입을 막지 않는다(그 밖의 실패는 막는다)');
{
  const m = (e) => (fn(isMissingRpc) ? isMissingRpc(e) : '(함수 없음)');
  const MISSING = { code: 'PGRST202', message: 'Could not find the function public.record_my_consents(p_channel, p_items, p_version) in the schema cache' };
  check('★PGRST202 = 함수 없음', m(MISSING) === true, show(m(MISSING)));
  check('code 없이 원문만 "Could not find the function" 이어도 함수 없음', m({ message: MISSING.message }) === true);
  check('not_authenticated 는 함수 없음이 아니다', m({ code: 'P0001', message: 'not_authenticated' }) === false);
  check('컬럼 없음(PGRST204)은 함수 없음이 아니다', m({ code: 'PGRST204', message: "Could not find the 'x' column of 'y' in the schema cache" }) === false);
  check('네트워크 실패는 함수 없음이 아니다', m({ message: 'TypeError: Failed to fetch' }) === false);
  check('null 은 false', m(null) === false);

  const store = strip(read('src/lib/store/useSessionStore.ts')).replace(/\s+/g, ' ');
  const body = (store.match(/completeProfile: async[\s\S]*?rpcCompleteProfile\(/) || [''])[0];
  check('★completeProfile 이 동의 실패 중 함수 없음만 걸러 낸다(isMissingRpc)', /isMissingRpc\(cErr\)/.test(body));
  check('함수 없음은 reportError 로 남긴다', /reportError\('session\.completeProfile\.consentRpcMissing'/.test(body));
  check('그 밖의 동의 실패는 여전히 프로필 저장 전에 돌아간다', /if \(cErr && !isMissingRpc\(cErr\)\) \{ return/.test(body));
}

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
