#!/usr/bin/env node
// qa-min-wage.mjs — 최저시급 판정(src/lib/utils/attendance.ts)과 급여 설정 문구 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 결함 Q12:
//   ① 급여 설정의 휴게 안내가 "4시간당 30분"이었다. 실제 계산(payroll.ts)은 4시간 이상 30분 · 8시간 이상 60분이다.
//   ② 야간수당 안내가 "1.5배 가산"이었다. 실제 계산은 +0.5배 가산이고, 5인 미만은 의무가 아니다.
//   ③ 최저시급 상수가 2025년 값(10,030원) 하나였고, 미설정 직원의 대체 시급으로 쓰였다. 최저시급 미만 경고는 없었다.
//   → MIN_WAGE 표와 minimumWageFor(date). 미만이면 경고만 한다(수습 감액 같은 예외가 있다 · 최저임금법 제5조 2항).
//   → DEFAULT_HOURLY_WAGE 와 대체값을 지운다. 시급이 없으면 금액을 숨긴다.
// 실행: node scripts/qa-min-wage.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

let mod = {};
try {
  mod = await import('../src/lib/utils/attendance.ts');
} catch (e) {
  console.log('  FAIL 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}
const { MIN_WAGE, minimumWageFor, minWageWarning } = mod;
const fn = (f) => typeof f === 'function';
const call = (f, ...a) => (fn(f) ? f(...a) : undefined);

console.log('\n■ MIN_WAGE — 해마다 다른 최저시급');
check('2025년 10,030원', MIN_WAGE?.[2025] === 10030, `→ ${MIN_WAGE?.[2025]}`);
check('★2026년 10,320원', MIN_WAGE?.[2026] === 10320, `→ ${MIN_WAGE?.[2026]}`);
check('★2027년 10,700원', MIN_WAGE?.[2027] === 10700, `→ ${MIN_WAGE?.[2027]}`);

console.log('\n■ minimumWageFor(date) — 그 날짜가 속한 해의 최저시급');
check('2025-12-31 → 10,030원', call(minimumWageFor, '2025-12-31') === 10030, `→ ${call(minimumWageFor, '2025-12-31')}`);
check('★2026-01-01 → 10,320원', call(minimumWageFor, '2026-01-01') === 10320, `→ ${call(minimumWageFor, '2026-01-01')}`);
check('2026-10-05 → 10,320원', call(minimumWageFor, '2026-10-05') === 10320, `→ ${call(minimumWageFor, '2026-10-05')}`);
check('★2027-01-01 → 10,700원', call(minimumWageFor, '2027-01-01') === 10700, `→ ${call(minimumWageFor, '2027-01-01')}`);
// 표에 없는 해는 가장 가까운 해 값을 쓴다. 최저임금은 내려간 적이 없어 뒤의 해에는 하한으로 맞다.
check('표 뒤의 해(2028) → 마지막 값 10,700원', call(minimumWageFor, '2028-03-01') === 10700, `→ ${call(minimumWageFor, '2028-03-01')}`);
check('표 앞의 해(2024) → 첫 값 10,030원', call(minimumWageFor, '2024-06-01') === 10030, `→ ${call(minimumWageFor, '2024-06-01')}`);

console.log('\n■ minWageWarning(wage, date) — 미만일 때만 경고 문구, 아니면 null');
const W26 = '시급이 2026년 최저시급 10,320원보다 낮아요. 수습 기간이 아니라면 다시 확인해 주세요.';
check('★2026년 10,319원 → 경고', call(minWageWarning, 10319, '2026-10-05') === W26, `→ ${call(minWageWarning, 10319, '2026-10-05')}`);
check('★2026년 10,320원(같음) → 경고 없음', fn(minWageWarning) && call(minWageWarning, 10320, '2026-10-05') === null);
check('2026년 12,000원 → 경고 없음', fn(minWageWarning) && call(minWageWarning, 12000, '2026-10-05') === null);
check('옛 대체값 10,030원은 2026년에 경고', call(minWageWarning, 10030, '2026-10-05') === W26);
check('2027년 10,500원 → 2027년 기준 경고', call(minWageWarning, 10500, '2027-01-02') === '시급이 2027년 최저시급 10,700원보다 낮아요. 수습 기간이 아니라면 다시 확인해 주세요.', `→ ${call(minWageWarning, 10500, '2027-01-02')}`);

console.log('\n■ 대체 시급을 지운다 — 시급이 없으면 금액을 숨긴다');
check('★DEFAULT_HOURLY_WAGE 를 내보내지 않는다', !('DEFAULT_HOURLY_WAGE' in mod));
const junior = src('src/app/junior/attendance.tsx');
check('★출퇴근 화면이 대체 시급을 쓰지 않는다', !/DEFAULT_HOURLY_WAGE/.test(junior.replace(/\/\/.*$/gm, '')));

console.log('\n■ 급여 설정 문구 = 실제 계산');
const payroll = src('src/app/owner/payroll.tsx');
check('★휴게 "4시간 이상 30분 · 8시간 이상 1시간(무급)"', payroll.includes('hint="4시간 이상 30분 · 8시간 이상 1시간(무급)"'));
check('옛 휴게 문구 "4시간당 30분" 없음', !payroll.includes('4시간당'));
check('★야간 "22~06시 0.5배 가산 (5인 이상 의무)"', payroll.includes('hint="22~06시 0.5배 가산 (5인 이상 의무)"'));
check('옛 야간 문구 "1.5배 가산" 없음', !payroll.includes('22~06시 1.5배'));

console.log('\n■ 시급을 정할 때 최저시급 미만이면 경고만 한다');
const staff = src('src/app/owner/staff.tsx');
check('★사장 직원 화면이 minWageWarning 을 쓴다', /minWageWarning\(/.test(staff));

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 || !fn(minimumWageFor) ? 1 : 0);
