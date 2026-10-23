#!/usr/bin/env node
// PAY-02 (2026-10-23): 정산 시작일(Q11)을 실제 급여 기간에 적용한다 — 순수 함수 검사.
//   결정(사용자 10-23): (a) 컷오버 = 이번 빌드 배포일(PAY_PERIOD_FROM). 그 뒤에 시작하는 기간부터 시작일을 쓴다.
//   (b) 시작일을 바꾸면 즉시 반영. 컷오버 뒤 지난 기간도 최신 시작일로 다시 나눈다(이력 무시).
//   컷오버 앞 달력 월 기간은 절대 바뀌지 않는다. Q9 주휴 컷오버(PAYROLL_V2_FROM)와는 독립이다.
// 실행: node --no-warnings scripts/qa-audit-pay-period.mjs
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

let Q = {}, P = {}, S = {};
try { Q = await import('../src/lib/utils/payPeriod.ts'); } catch (e) { check('payPeriod.ts 를 읽는다', false, String(e?.code ?? e)); }
P = await import('../src/lib/utils/payroll.ts');
S = await import('../src/lib/utils/schedule.ts');
const { payPeriodFor, payLabelOf, paydayAfter, fmtPeriodRange, PAY_PERIOD_FROM } = Q;
const ok = typeof payPeriodFor === 'function';
const C = '2026-10-24';
const span = (p) => (p ? `${p.from}~${p.to}(${p.kind})` : 'null');
const labels = (fromYm, n) => { const out = []; let [y, m] = fromYm.split('-').map(Number); for (let i = 0; i < n; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return out; };

console.log('[상수] 컷오버는 따로 있다');
check('PAY_PERIOD_FROM 기본값 = 2026-10-24', PAY_PERIOD_FROM === '2026-10-24', String(PAY_PERIOD_FROM));
check('Q9 주휴 컷오버(PAYROLL_V2_FROM)는 그대로 2026-10-01 이고 정산 기간 코드는 그것을 안 쓴다',
  P.PAYROLL_V2_FROM === '2026-10-01' && !/PAYROLL_V2_FROM/.test(readFileSync(new URL('../src/lib/utils/payPeriod.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));

console.log('\n[시작일 1] 지금 동작과 1원도 다르지 않다');
if (ok) {
  let same = true, bad = '';
  for (const ym of labels('2025-01', 60)) {
    const old = P.payWindow(ym); const neu = P.payWindow(ym, 1);
    if (JSON.stringify(old) !== JSON.stringify(neu)) { same = false; bad = ym; }
    const p = payPeriodFor(ym, 1, C);
    if (p.from !== old.from || p.to !== old.to) { same = false; bad = ym; }
  }
  check('2025-01~2029-12 모든 달: 기간·입력일이 달력 월과 같다', same, bad);
}

console.log('\n[시작일 25 · 컷오버 10-24]');
if (ok) {
  const p = (ym) => payPeriodFor(ym, 25, C);
  check('9월분 = 9/1~9/30 달력', span(p('2026-09')) === '2026-09-01~2026-09-30(calendar)', span(p('2026-09')));
  check('★10월분(컷오버가 든 달) = 10/1~10/31 달력 그대로', span(p('2026-10')) === '2026-10-01~2026-10-31(calendar)', span(p('2026-10')));
  check('★11월분 = 11/1~11/24 전환 기간', span(p('2026-11')) === '2026-11-01~2026-11-24(transition)', span(p('2026-11')));
  check('12월분 = 11/25~12/24', span(p('2026-12')) === '2026-11-25~2026-12-24(period)', span(p('2026-12')));
  check('범위 문구 = "11월 25일~12월 24일"', fmtPeriodRange(p('2026-12')) === '11월 25일~12월 24일', fmtPeriodRange(p('2026-12')));
  check('오늘 11/20 → 11월분(전환) · 11/26 → 12월분', payLabelOf('2026-11-20', 25, C) === '2026-11' && payLabelOf('2026-11-26', 25, C) === '2026-12');
  check('오늘 10/30 → 10월분(달력)', payLabelOf('2026-10-30', 25, C) === '2026-10');
}

console.log('\n[짧은 달 · 윤년 · 시작일 31/30/29]');
if (ok) {
  check('31일 시작 · 2027-02월분 = 1/31~2/27', span(payPeriodFor('2027-02', 31, C)) === '2027-01-31~2027-02-27(period)', span(payPeriodFor('2027-02', 31, C)));
  check('31일 시작 · 2027-03월분 = 2/28~3/30(2월은 말일로 맞춤)', span(payPeriodFor('2027-03', 31, C)) === '2027-02-28~2027-03-30(period)', span(payPeriodFor('2027-03', 31, C)));
  check('★윤년 31일 시작 · 2028-03월분 = 2/29~3/30', span(payPeriodFor('2028-03', 31, C)) === '2028-02-29~2028-03-30(period)', span(payPeriodFor('2028-03', 31, C)));
  check('윤년 29일 시작 · 2028-03월분 = 2/29~3/28', span(payPeriodFor('2028-03', 29, C)) === '2028-02-29~2028-03-28(period)', span(payPeriodFor('2028-03', 29, C)));
  check('평년 30일 시작 · 2027-03월분 = 2/28~3/29', span(payPeriodFor('2027-03', 30, C)) === '2027-02-28~2027-03-29(period)', span(payPeriodFor('2027-03', 30, C)));
  check('31일 시작 · 4월(30일)분 = 3/31~4/29', span(payPeriodFor('2027-04', 31, C)) === '2027-03-31~2027-04-29(period)', span(payPeriodFor('2027-04', 31, C)));
  check('31일 시작 · 전환 = 11/1~11/29', span(payPeriodFor('2026-11', 31, C)) === '2026-11-01~2026-11-29(transition)', span(payPeriodFor('2026-11', 31, C)));
}

console.log('\n[경계] 모든 시작일 1~31 · 2026-01~2030-12: 빈 날 0 · 겹친 날 0 · 날짜→기간 왕복');
if (ok) {
  let gaps = 0, overlaps = 0, miss = 0, empty = 0;
  for (let s = 1; s <= 31; s++) {
    const ls = labels('2026-01', 60);
    for (let i = 1; i < ls.length; i++) {
      const a = payPeriodFor(ls[i - 1], s, C), b = payPeriodFor(ls[i], s, C);
      const nx = S.addDays(a.to, 1);
      if (nx < b.from) gaps++; else if (nx > b.from) overlaps++;
      if (b.from > b.to) empty++;
    }
    for (let d = '2026-01-01'; d <= '2030-11-30'; d = S.addDays(d, 1)) {
      const p = payPeriodFor(payLabelOf(d, s, C), s, C);
      if (!(p.from <= d && d <= p.to)) miss++;
    }
  }
  check('★빈 날 0', gaps === 0, String(gaps));
  check('★겹친 날 0', overlaps === 0, String(overlaps));
  check('빈 기간 0', empty === 0, String(empty));
  check('날짜가 든 기간을 정확히 찾는다', miss === 0, String(miss));
}

// 매일 9~18시 근무 1년치. 기간별 근무분 합 = 전체 근무분(경계 근무 누락·중복 0).
const shiftsBetween = (from, to) => { const out = []; for (let d = from; d <= to; d = S.addDays(d, 1)) out.push({ date: d, check_in: `${d}T00:00:00.000Z`, check_out: `${d}T09:00:00.000Z`, work_minutes: 540 }); return out; };
const RULES = { breakDeduction: true, nightAllowance: true, overtimeAllowance: true, weeklyHolidayPay: true, extraAllowance: 0 };
const NOW = '2031-01-01T00:00:00.000Z';

console.log('\n[경계 근무] 기간별 근무분 합 = 전체');
if (ok) {
  for (const s of [1, 25, 31]) {
    const ls = labels('2026-08', 18);
    const first = payPeriodFor(ls[0], s, C), last = payPeriodFor(ls.at(-1), s, C);
    const all = shiftsBetween(S.mondayOf(first.from), last.to);
    let sum = 0;
    for (const ym of ls) sum += P.computePay(all, 10320, RULES, NOW, P.payWindow(ym, s, C)).workedMin;
    const expect = (Date.parse(last.to) - Date.parse(first.from)) / 864e5 * 540 + 540;
    check(`시작일 ${s}: 근무분 합 ${sum} = 전체 ${expect}`, sum === expect);
  }
}

console.log('\n[컷오버 앞 금액 보존 · 시작일 변경 전후]');
if (ok) {
  const all = shiftsBetween('2025-12-01', '2027-06-30');
  const pay = (ym, s) => P.computePay(all, 10320, RULES, NOW, P.payWindow(ym, s, C)).total;
  let same = true, bad = '';
  for (const ym of labels('2026-01', 10)) for (const s of [10, 25, 31]) if (pay(ym, s) !== pay(ym, 1) || pay(ym, s) !== P.computePay(all, 10320, RULES, NOW, P.payWindow(ym)).total) { same = false; bad = `${ym}/${s}`; }
  check('★컷오버 앞(2026-01~10월분) 금액: 시작일 1·10·25·31 모두 지금 금액과 1원도 다르지 않다', same, bad);
  // 25 → 10 으로 바꾸면 컷오버 뒤 기간은 최신 값으로 다시 나뉜다(이력 무시 · 결정 b).
  const before = payPeriodFor('2027-01', 25, C), after = payPeriodFor('2027-01', 10, C);
  check('★시작일 25→10: 2027-01월분이 12/25~1/24 → 12/10~1/9 로 다시 나뉜다', span(before) === '2026-12-25~2027-01-24(period)' && span(after) === '2026-12-10~2027-01-09(period)', `${span(before)} → ${span(after)}`);
  check('시작일 25→10: 전환 기간도 최신 값(11/1~11/9)', span(payPeriodFor('2026-11', 10, C)) === '2026-11-01~2026-11-09(transition)');
  check('시작일 25→10: 10월분은 달력 그대로', span(payPeriodFor('2026-10', 10, C)) === '2026-10-01~2026-10-31(calendar)');
}

console.log('\n[지급일] 기간이 끝난 뒤 처음 오는 지급일');
if (ok) {
  check('10/24 끝 · 10일 → 11/10', paydayAfter('2026-10-24', 10) === '2026-11-10');
  check('11/24 끝 · 25일 → 11/25(같은 달 뒤)', paydayAfter('2026-11-24', 25) === '2026-11-25');
  check('10/31 끝 · 31일 → 11/30(말일 보정)', paydayAfter('2026-10-31', 31) === '2026-11-30');
  check('1/31 끝 · 30일 → 2/28', paydayAfter('2027-01-31', 30) === '2027-02-28');
  check('윤년 1/31 끝 · 31일 → 2/29', paydayAfter('2028-01-31', 31) === '2028-02-29');
  check('끝 날 = 지급일이면 다음 달', paydayAfter('2026-11-10', 10) === '2026-12-10');
}

console.log('\n[컷오버 값을 바꿔도 같은 규칙] 배포일이 11/1 이면 11월이 바로 전환');
if (ok) {
  check('컷오버 11/1 · 25일: 11월분 = 11/1~11/24 전환', span(payPeriodFor('2026-11', 25, '2026-11-01')) === '2026-11-01~2026-11-24(transition)');
  check('컷오버 11/5 · 25일: 11월분 = 달력, 12월분 = 12/1~12/24 전환', span(payPeriodFor('2026-11', 25, '2026-11-05')) === '2026-11-01~2026-11-30(calendar)' && span(payPeriodFor('2026-12', 25, '2026-11-05')) === '2026-12-01~2026-12-24(transition)');
}

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
