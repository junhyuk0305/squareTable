#!/usr/bin/env node
// qa-report-form.mjs — 설정의 신고하기(src/lib/report/form.ts) 순수 함수 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 F-1(마스터 계획 P3-6 · 정책 검토 M5): 사람끼리 채팅에 신고 수단이 없었다. 설정에는 문의하기만 있었다.
//   서버(0241)는 submit_user_report · report_targets 를 이미 받는다. 이 하니스는 앱 쪽 두 가지를 못박는다.
//   (1) 오류 코드 → 문구: 0241 이 raise 하는 코드 전부에 사람 말 문구가 있다(AGENTS ⑨ — 코드 원문을 화면에 내지 않는다).
//       코드 목록은 마이그레이션에서 읽는다. 서버에 코드가 늘면 여기서 바로 FAIL 이 난다.
//   (2) 보내기 전 검사(prepareReport): 서버와 같은 규칙을 먼저 본다.
//       대상 없으면 'ai_answer' 만 · 내용 5~1000자(서버 char_length = 코드 포인트) · 시각은 KST · 10분 넘게 미래면 거절.
//   (3) 설정 화면 "문의하기" 바로 아래 "신고하기" 한 행, 화면은 db.ts 를 거쳐서만 RPC 를 부른다.
// 실행: node scripts/qa-report-form.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);

let mod = {};
try {
  mod = await import('../src/lib/report/form.ts');
} catch (e) {
  console.log('  FAIL 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}
const { reportErrorMessage, prepareReport, PERSON_CATEGORIES, AI_TARGET_LABEL, REPORT_DONE_TEXT, REPORT_NO_STORE_TEXT, REPORT_DAYS } = mod;
const fn = (f) => typeof f === 'function';
const msg = (e) => (fn(reportErrorMessage) ? reportErrorMessage(e) : '(함수 없음)');
const prep = (f, now) => (fn(prepareReport) ? prepareReport(f, now) : { error: '(함수 없음)' });

const read = (p) => {
  try {
    return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  } catch (e) {
    check(`${p} 를 읽는다`, false, String(e && e.code ? e.code : e));
    return '';
  }
};
// 주석을 걷어 낸 코드만 본다.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// 화면 문구 공통 금지: 개발 말(코드·영문 식별자) · 대시 · 문장 잇는 중간점 · 결제 채널 말(3.1.1)
const DEV = /[a-z]+_[a-z]+|not_|invalid|rate|uuid|error|exception/i;
const STYLE = /—| · /;
const CHANNEL = /카드|웹에서|토스/;

console.log('\n■ (1) 0241 의 오류 코드 전부에 문구가 있다');
const mig = read('supabase/migrations/0241_user_reports.sql');
const body = (name) => {
  const m = mig.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?end \\$\\$;`));
  return m ? m[0] : '';
};
const codesOf = (src) => [...new Set([...src.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]))];
const SUBMIT = codesOf(body('submit_user_report'));
const TARGETS = codesOf(body('report_targets'));
check('submit_user_report 코드 11개를 읽었다', SUBMIT.length === 11, show(SUBMIT));
check('report_targets 코드 3개를 읽었다', TARGETS.length === 3, show(TARGETS));
const FALLBACK = msg({ message: 'zz_unknown_code' });
check('모르는 코드 → 일반 문구', typeof FALLBACK === 'string' && FALLBACK.length > 0 && !DEV.test(FALLBACK), show(FALLBACK));
check('오류가 null 이어도 일반 문구', msg(null) === FALLBACK, show(msg(null)));
for (const code of new Set([...SUBMIT, ...TARGETS])) {
  const m = msg({ message: code });
  check(`${code} → 따로 정한 문구`, typeof m === 'string' && m !== FALLBACK && m.length > 0, show(m));
  check(`${code} 문구에 개발 말·대시·채널 말이 없다`, typeof m === 'string' && !DEV.test(m) && !STYLE.test(m) && !CHANNEL.test(m), show(m));
}
check('코드 뒤에 붙은 말이 있어도 코드로 읽는다', msg({ message: 'rate_limited: x' }) === msg({ message: 'rate_limited' }));
check('★대상이 이미 나간 사람(target_not_member)이면 문의하기로 안내한다', String(msg({ message: 'target_not_member' })).includes('문의하기'));

console.log('\n■ (2) 분류와 고정 문구');
const CHECK = (mig.match(/category\s+text\s+not null check \(category in \(([^)]*)\)\)/) || [])[1] || '';
const SERVER_CATS = [...CHECK.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
check('서버 분류 6개를 읽었다', SERVER_CATS.length === 6, show(SERVER_CATS));
const personKeys = Array.isArray(PERSON_CATEGORIES) ? PERSON_CATEGORIES.map((c) => c.key) : [];
check(
  '사람 신고 분류 = 서버 분류에서 ai_answer 를 뺀 5개(순서 그대로)',
  show(personKeys) === show(SERVER_CATS.filter((k) => k !== 'ai_answer')),
  show(personKeys),
);
check(
  '분류 이름에 개발 말이 없다',
  Array.isArray(PERSON_CATEGORIES) && PERSON_CATEGORIES.every((c) => typeof c.label === 'string' && c.label && !DEV.test(c.label)),
  show(PERSON_CATEGORIES),
);
check("AI 대상 이름 = 'AI 답변 문제'", AI_TARGET_LABEL === 'AI 답변 문제', show(AI_TARGET_LABEL));
check("성공 문구 = '접수했어요. 운영팀이 확인해요.'", REPORT_DONE_TEXT === '접수했어요. 운영팀이 확인해요.', show(REPORT_DONE_TEXT));
check(
  "매장 0곳 문구 = '매장에 소속돼 있을 때 신고할 수 있어요.'",
  REPORT_NO_STORE_TEXT === '매장에 소속돼 있을 때 신고할 수 있어요.',
  show(REPORT_NO_STORE_TEXT),
);
check('날짜 칩 = 오늘·어제·그저께', show(Array.isArray(REPORT_DAYS) ? REPORT_DAYS.map((d) => [d.offset, d.label]) : null) === show([[0, '오늘'], [1, '어제'], [2, '그저께']]));

console.log('\n■ (3) 보내기 전 검사 prepareReport');
// now = 2026-10-05 12:00 KST
const NOW = new Date('2026-10-05T03:00:00.000Z');
const BASE = { unitId: 'store_001', targetId: 'u-2', ai: false, category: 'harassment', body: '욕을 했어요 계속', day: null, time: '' };
const ok = (r) => r && !r.error && r.payload;
const err = (r) => (r && r.error) || null;
{
  const r = prep(BASE, NOW);
  check('정상 사람 신고 → payload', ok(r), show(r));
  check(
    'payload = 매장·대상·분류·다듬은 내용·시각 null',
    ok(r) && show(r.payload) === show({ unitId: 'store_001', target: 'u-2', category: 'harassment', body: '욕을 했어요 계속', occurredAt: null }),
    show(r && r.payload),
  );
}
check('매장 없음 → 거절', !!err(prep({ ...BASE, unitId: '' }, NOW)), show(prep({ ...BASE, unitId: '' }, NOW)));
check('대상 없음(사람) → 거절', !!err(prep({ ...BASE, targetId: null }, NOW)), show(prep({ ...BASE, targetId: null }, NOW)));
check('분류 없음(사람) → 거절', !!err(prep({ ...BASE, category: null }, NOW)), show(prep({ ...BASE, category: null }, NOW)));
check("사람 신고에 'ai_answer' 분류 → 거절", !!err(prep({ ...BASE, category: 'ai_answer' }, NOW)));
check('모르는 분류 → 거절', !!err(prep({ ...BASE, category: 'xx' }, NOW)));
{
  const r = prep({ ...BASE, ai: true, targetId: 'u-2', category: null }, NOW);
  check("★AI 답변 문제 → 대상 null · 분류 'ai_answer'(분류를 안 골라도 된다)", ok(r) && r.payload.target === null && r.payload.category === 'ai_answer', show(r));
}
{
  const r = prep({ ...BASE, body: '  가나다라  ' }, NOW);
  check('다듬은 내용 4자 → 거절', !!err(r), show(r));
  const r2 = prep({ ...BASE, body: '  가나다라마  ' }, NOW);
  check('다듬은 내용 5자 → 통과 · 앞뒤 공백을 걷는다', ok(r2) && r2.payload.body === '가나다라마', show(r2));
  check('1001자 → 거절', !!err(prep({ ...BASE, body: '가'.repeat(1001) }, NOW)));
  check('1000자 → 통과', ok(prep({ ...BASE, body: '가'.repeat(1000) }, NOW)));
  check('★이모지 1000개(서버 char_length 1000) → 통과', ok(prep({ ...BASE, body: '😀'.repeat(1000) }, NOW)));
  check('★이모지 3개(서버 char_length 3) → 거절', !!err(prep({ ...BASE, body: '😀😀😀' }, NOW)));
}
console.log('  · 있었던 때(KST)');
{
  const r = prep({ ...BASE, day: 1, time: '18:30' }, NOW);
  check('어제 18:30 KST → 2026-10-04T09:30Z', ok(r) && r.payload.occurredAt === '2026-10-04T09:30:00.000Z', show(r));
  const late = new Date('2026-10-04T16:30:00.000Z'); // 2026-10-05 01:30 KST
  const r2 = prep({ ...BASE, day: 1, time: '23:00' }, late);
  check('★자정 넘긴 새벽에 고른 어제 23:00 = KST 10-04 23:00(UTC 날짜로 계산하지 않는다)', ok(r2) && r2.payload.occurredAt === '2026-10-04T14:00:00.000Z', show(r2));
  const r3 = prep({ ...BASE, day: 2, time: '07:05' }, NOW);
  check('그저께 07:05 → 2026-10-02T22:05Z', ok(r3) && r3.payload.occurredAt === '2026-10-02T22:05:00.000Z', show(r3));
  check('오늘 12:05(10분 안 미래) → 통과', ok(prep({ ...BASE, day: 0, time: '12:05' }, NOW)));
  check('오늘 23:00(10분 넘게 미래) → 거절', !!err(prep({ ...BASE, day: 0, time: '23:00' }, NOW)), show(prep({ ...BASE, day: 0, time: '23:00' }, NOW)));
  check('날짜만 고르고 시각 비움 → 거절', !!err(prep({ ...BASE, day: 0, time: '' }, NOW)));
  for (const t of ['18:3', '1830', '24:00', '12:60', 'ab:cd']) check(`시각 "${t}" → 거절`, !!err(prep({ ...BASE, day: 0, time: t }, NOW)));
  const r4 = prep({ ...BASE, day: null, time: '18:30' }, NOW);
  check('날짜를 안 골랐으면 시각 칸 값은 쓰지 않는다', ok(r4) && r4.payload.occurredAt === null, show(r4));
}
{
  const all = [
    prep({ ...BASE, unitId: '' }, NOW), prep({ ...BASE, targetId: null }, NOW), prep({ ...BASE, category: null }, NOW),
    prep({ ...BASE, body: 'ab' }, NOW), prep({ ...BASE, day: 0, time: '23:00' }, NOW), prep({ ...BASE, day: 0, time: '' }, NOW),
  ].map(err);
  check('검사 문구에 개발 말·대시·채널 말이 없다', all.every((m) => typeof m === 'string' && !DEV.test(m) && !STYLE.test(m) && !CHANNEL.test(m)), show(all));
}

console.log('\n■ (4) 화면 연결');
{
  const src = strip(read('src/app/account-settings.tsx'));
  const i = src.indexOf('label="문의하기"');
  const j = src.indexOf('label="신고하기"');
  const k = src.indexOf('label="버전 정보"');
  // 사이에 다른 행 라벨이 없어야 "바로 아래"다.
  check('★설정에 "신고하기" 행이 "문의하기" 바로 아래 있다', i > 0 && j > i && k > j && !src.slice(i + 1, j).includes('label="'), show({ i, j, k }));
  check('"신고하기" 행이 /report 로 간다', /label="신고하기"[^>]*router\.push\('\/report'/.test(src));
}
{
  const src = strip(read('src/lib/db.ts'));
  check("db.ts 가 rpc('report_targets', { p_unit_id }) 를 부른다", /rpc\('report_targets', \{ p_unit_id: /.test(src));
  check(
    "db.ts 가 rpc('submit_user_report') 를 다섯 인자 이름으로 부른다",
    /rpc\('submit_user_report', \{\s*p_unit_id:[\s\S]{0,40}p_target:[\s\S]{0,40}p_category:[\s\S]{0,40}p_body:[\s\S]{0,40}p_occurred_at:/.test(src),
  );
}
{
  const src = strip(read('src/app/report.tsx'));
  check('report.tsx 가 있다', src.length > 0);
  check('화면은 supabase 를 직접 부르지 않는다(AGENTS ③)', src.length > 0 && !/supabase/.test(src));
  check('화면이 prepareReport · reportErrorMessage 를 쓴다', /prepareReport\(/.test(src) && /reportErrorMessage\(/.test(src));
  check('화면이 AI 대상 이름을 상수로 쓴다', /AI_TARGET_LABEL/.test(src));
  check('화면이 error.message 원문을 그리지 않는다', !/\.message\b/.test(src));
}

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 || !fn(prepareReport) ? 1 : 0);
