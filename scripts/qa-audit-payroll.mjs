#!/usr/bin/env node
// qa-audit-payroll.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 급여·근무표 묶음 재현 검사.
//   [A4] 시급을 바꾸면 그 자리에서 이번 달 예상 급여가 새 시급으로 바뀐다(앱을 다시 켜지 않아도).
//   [A5] 시급 이력을 못 읽으면 지난달 급여를 지금 시급으로 만들지 않고 "못 불러왔다"고 말한다.
// 실행: node --no-warnings scripts/qa-audit-payroll.mjs
import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const fn = (f) => typeof f === 'function';
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') : '');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let P = {};
try { P = await import('../src/lib/utils/payroll.ts'); } catch (e) { check('payroll.ts 를 읽는다', false, String(e?.code ?? e)); }

console.log('[A4] 시급을 바꾸면 이번 달 예상 급여가 바로 새 시급이다');
{
  const { wageForMonth, withTodayWage } = P;
  const today = '2026-10-12';
  const rates = [{ staff_id: 'a', hourly_wage: 10320, effective_from: '2000-01-01' }];
  const next = fn(withTodayWage) ? withTodayWage(rates, 'a', 12000, today) : rates;
  check('★바꾼 직후 이번 달 시급 = 12,000원', wageForMonth(next, 'a', '2026-10', today, 12000) === 12000, String(wageForMonth(next, 'a', '2026-10', today, 12000)));
  check('지난달 시급은 그대로 10,320원', wageForMonth(next, 'a', '2026-09', today, 12000) === 10320);
  const twice = fn(withTodayWage) ? withTodayWage(next, 'a', 12500, today) : next;
  check('같은 날 두 번 바꾸면 오늘 행 하나를 덮는다', twice.filter((r) => r.staff_id === 'a' && r.effective_from === today).length === 1 && wageForMonth(twice, 'a', '2026-10', today, 12500) === 12500);
  check('다른 직원 이력은 건드리지 않는다', fn(withTodayWage) && withTodayWage([...rates, { staff_id: 'b', hourly_wage: 11000, effective_from: today }], 'a', 12000, today).some((r) => r.staff_id === 'b' && r.hourly_wage === 11000));
  const st = strip(read('src/lib/store/usePayrollStore.ts'));
  check('★스토어 setWage 가 wageRates 에도 오늘 시급을 넣고, 실패하면 되돌린다', /setWage:[\s\S]*withTodayWage\(/.test(st) && /setWage:[\s\S]*wageRates: prevRates/.test(st));
}

console.log('\n[A5] 시급 이력 읽기 실패 = 지난달 금액을 만들지 않는다(배선)');
{
  const db = read('src/lib/db.ts'); // strip 은 db.ts 문자열 속 '/*' 에 걸려 본문을 지운다 — 원문으로 본다.
  const f = db.match(/export async function fetchWageRates[\s\S]*?\n}\n/)?.[0] ?? '';
  check('★fetchWageRates 가 실패를 신호로 돌려준다(ReadResult · readFail)', /Promise<ReadResult<WageRate\[\]>>/.test(f) && /readFail\('fetchWageRates'/.test(f) && /error: true/.test(f));
  const st = strip(read('src/lib/store/usePayrollStore.ts'));
  check('★스토어: 읽기 실패면 이전 이력을 덮지 않고 wageRatesLoadError 를 세운다', /wageRatesLoadError: ratesRes\.error/.test(st) && /ratesRes\.error \? \{\} : \{ wageRates: ratesRes\.data \}/.test(st));
  const tv = strip(read('src/components/TimesheetView.tsx'));
  check('★출근 기록 화면: 지난달 + 이력 실패면 금액 대신 안내', /wageRatesLoadError/.test(tv) && /pastRatesMissing/.test(tv) && /지난달 시급을 불러오지 못했어요/.test(tv));
}

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
