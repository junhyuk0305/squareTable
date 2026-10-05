#!/usr/bin/env node
// qa-iap-prepaid.mjs — 선불 기간이 남아 있으면 앱 결제를 잠근다(2026-10-05 사용자 결정). DB·네트워크를 쓰지 않는다.
//   [1] src/lib/iap/notes.ts 의 prepaidGuardNote 순수 함수: 끝나기 3일 전부터 결제할 수 있다(카드 가드와 같은 기준).
//   [2] 배선: db.ts 가 owner_prepaid_until 을 부르고, 옛 서버(함수 없음)면 잠그지 않는다. 패널이 구매 버튼을 잠근다.
// 서버 쪽(owner_prepaid_until 의 값)은 qa-iap ⑳ 이 본다.
// 실행: node scripts/qa-iap-prepaid.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let mod = {};
try {
  mod = await import('../src/lib/iap/notes.ts');
} catch (e) {
  console.log('  FAIL notes 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}
const { prepaidGuardNote } = mod;
const note = (...a) => (typeof prepaidGuardNote === 'function' ? prepaidGuardNote(...a) : '(함수 없음)');

const CHANNEL = /카드|웹에서|토스|계좌이체/;
const DAY = 86400000;
const now = new Date('2026-10-05T03:00:00Z').getTime();   // KST 10월 5일 낮
const at = (d) => new Date(now + d * DAY).toISOString();

console.log('\n[1] prepaidGuardNote');
{
  const t10 = note(at(10), now);
  check('★10일 남음 → 잠금 문구', t10 === '이용 기간이 10월 15일까지 남아 있어요. 끝나기 3일 전부터 결제할 수 있어요.', show(t10));
  check('3일 하고 조금 남음 → 아직 잠근다', typeof note(at(3.01), now) === 'string', show(note(at(3.01), now)));
  check('★정확히 3일 남음 → 결제할 수 있다(null)', note(at(3), now) === null, show(note(at(3), now)));
  check('1일 남음 → null', note(at(1), now) === null);
  check('이미 끝남 → null', note(at(-1), now) === null);
  check('선불 기간 없음(null) → null', note(null, now) === null);
  check('옛 서버·읽기 실패(undefined) → 잠그지 않는다', note(undefined, now) === null);
  check('날짜가 깨짐 → null', note('not-a-date', now) === null);
  check('해를 넘기면 연도를 붙인다', /2027년 1월/.test(note('2027-01-10T03:00:00Z', now) ?? ''), show(note('2027-01-10T03:00:00Z', now)));
  check('★결제 채널 말이 없다(3.1.1)', !CHANNEL.test(t10 ?? ''), show(t10));
}

console.log('\n[2] 배선(주석 제외 코드)');
{
  const db = strip(read('src/lib/db.ts'));
  check("db.ts 가 rpc('owner_prepaid_until') 를 부른다", /rpc\('owner_prepaid_until'/.test(db));
  check('★옛 서버(함수 없음)면 잠그지 않는다(isMissingRpc → null)', /owner_prepaid_until[\s\S]{0,400}?isMissingRpc\(/.test(db));
  const panel = strip(read('src/components/IapPurchasePanel.tsx'));
  check('패널이 prepaidGuardNote 로 고른다', /prepaidGuardNote\(/.test(panel));
  check('★구매 버튼 disabled 에 prepaidNote 가 들어간다', /disabled=\{busy[^}]*prepaidNote !== null/.test(panel));
  check('잠금 문구를 화면에 그린다', /\{prepaidNote !== null &&[^}]*<Text/.test(panel));
}

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
