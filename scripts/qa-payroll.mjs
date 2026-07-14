#!/usr/bin/env node
// qa-payroll.mjs — 급여 계산 엔진(computePay) 회귀 하네스.
// 왜: "급여 설정"(주휴수당·휴게공제·야간·연장·추가수당)이 계산에 반영되지 않아 모든 급여가 단순 분×시급으로
//   표시되던 F1(CRITICAL)을 computePay 로 SSOT화했다. 규칙 계산이 조용히 틀어지면 급여가 어긋나므로
//   표준 시나리오(주간/야간-자정넘김/연장/주휴/토글OFF/진행중/단시간)를 실코드로 못박는다.
// 방식: 러너가 없어 payroll.ts+attendance.ts 만 임시 트랜스파일 후 실제 함수로 검증(로직 중복 없음).
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.paytest');
try {
  execFileSync('npx', ['tsc',
    'src/lib/utils/attendance.ts', 'src/lib/utils/payroll.ts',
    '--outDir', '.paytest', '--module', 'es2022', '--target', 'es2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0',
  ], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
} catch (e) { /* tsc 는 성공해도 종종 비-0 경고 — 산출물 존재로 판정 */ }

const payPath = join(OUT, 'payroll.js');
writeFileSync(payPath, readFileSync(payPath, 'utf8').replace(/'\.\/attendance'/g, "'./attendance.js'"), 'utf8');
writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');

const { computePay } = await import('file://' + payPath.replace(/\\/g, '/'));

const W = 10000, NOW = '2026-07-01T05:00:00Z'; // 고정 now(=KST 14:00) — 진행중 근무 결정성
const ALL = { breakDeduction: true, nightAllowance: true, overtimeAllowance: true, weeklyHolidayPay: true, extraAllowance: 0 };
const R = (date, ci, co, coD = date) => ({
  date,
  check_in: new Date(`${date}T${ci}:00+09:00`).toISOString(),
  check_out: co ? new Date(`${coD}T${co}:00+09:00`).toISOString() : null,
  work_minutes: 0,
});
let pass = 0, fail = 0;
const eq = (m, g, e) => { const ok = g === e; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${m}: got=${g} exp=${e}`); ok ? pass++ : fail++; };

let r = computePay([R('2026-07-01', '10:00', '15:00')], W, ALL, NOW);
eq('5h주간 base(휴게30→4.5h)', r.base, 45000);
r = computePay([R('2026-07-01', '22:00', '06:00', '2026-07-02')], W, ALL, NOW);
eq('야간 base(7h)', r.base, 70000); eq('야간 nightMin', r.nightMin, 480); eq('야간 nightPay(+0.5)', r.nightPay, 40000); eq('야간 total', r.total, 110000);
r = computePay([R('2026-07-01', '09:00', '19:00')], W, ALL, NOW);
eq('10h 연장분', r.overtimeMin, 60); eq('10h 연장수당', r.overtimePay, 5000);
r = computePay(['2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'].map((d) => R(d, '10:00', '15:00')), W, ALL, NOW);
eq('주25h(paid22.5)≥15 주휴', r.weeklyHolidayPay, Math.round((22.5 / 40) * 8 * W));
r = computePay([R('2026-07-01', '22:00', '06:00', '2026-07-02')], W, { ...ALL, nightAllowance: false, breakDeduction: false }, NOW);
eq('토글OFF night', r.nightPay, 0); eq('토글OFF 휴게X base(8h)', r.base, 80000);
r = computePay([R('2026-07-01', '10:00', null)], W, ALL, NOW);
eq('진행중 실시간 base(4h-휴게30=3.5h)', r.base, 35000); eq('진행중 workedMin', r.workedMin, 240);
r = computePay([R('2026-07-01', '10:00', '13:00')], W, ALL, NOW);
eq('3h 휴게없음 base', r.base, 30000);
r = computePay([R('2026-07-01', '11:00', '11:20')], W, ALL, NOW); // 20분<30분 절삭→0
eq('20분 30분절삭→0', r.base, 0);
r = computePay([R('2026-07-01', '10:00', '15:00')], W, { ...ALL, extraAllowance: 50000 }, NOW);
eq('추가수당 합산', r.total, 45000 + 50000);

// rmSync 재귀삭제는 Windows Node 24.x에서 네이티브 크래시(0xC0000409)로 15/15 PASS 후 exit 127 —
// 비동기 rm은 정상이라 이것만 사용(결과 출력을 정리보다 먼저).
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await rm(OUT, { recursive: true, force: true }).catch(() => {});
process.exit(fail ? 1 : 0);
