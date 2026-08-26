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

// ── 휴게 공제는 **하루 합계** 기준 (2026-08-26 · 근로기준법 §54 = "1일 근로시간") ──────────
// 예전엔 근무 1건마다 계산해, 같은 하루 6시간인데 기록이 1건이냐 2건이냐로 지급액이 달라졌다.
// ★이 블록의 앞 4개는 **수정 전 코드에서 RED** 다(건별이면 휴게가 0 이라 금액이 더 나온다).
r = computePay([R('2026-07-01', '12:00', '15:00'), R('2026-07-01', '16:00', '19:00')], W, ALL, NOW);
eq('★하루 3h+3h=6h → 휴게 30분(합계 기준)', r.breakMin, 30);
eq('★하루 3h+3h → 유급 330분', r.paidMin, 330);
eq('★하루 3h+3h → base(1건짜리 6h 와 같다)', r.base, computePay([R('2026-07-01', '12:00', '18:00')], W, ALL, NOW).base);
r = computePay([R('2026-07-02', '10:00', '12:00'), R('2026-07-02', '14:00', '15:00')], W, ALL, NOW);
eq('★하루 2h+1h=3h → 휴게 0(4시간 미만)', r.breakMin, 0);
// (5h+4h 는 건별로도 30+30=60 이라 옛 규칙과 값이 같다 — 경계 확인용이지 이 변경의 증거는 아니다.)
r = computePay([R('2026-07-03', '09:00', '14:00'), R('2026-07-03', '15:00', '19:00')], W, ALL, NOW);
eq('하루 5h+4h=9h → 휴게 60분(8시간 이상)', r.breakMin, 60);
eq('하루 5h+4h → 유급 480분 · 연장 0(8h 초과분 없음)', r.overtimeMin, 0);
// ★3h 세 건 = 9h — 건별이면 전부 4h 미만이라 휴게 0 이었다. **연장수당까지 달라진다.**
r = computePay([R('2026-07-04', '08:00', '11:00'), R('2026-07-04', '12:00', '15:00'), R('2026-07-04', '16:00', '19:00')], W, ALL, NOW);
eq('★하루 3h×3=9h → 휴게 60분(옛 규칙은 0)', r.breakMin, 60);
eq('★하루 3h×3 → 유급 480분(옛 규칙은 540)', r.paidMin, 480);
eq('★하루 3h×3 → 연장 0분(옛 규칙은 60)', r.overtimeMin, 0);
// 회귀 — 규칙을 바꿔도 여기가 흔들리면 안 되는 것들
r = computePay([R('2026-07-01', '12:00', '15:00'), R('2026-07-01', '16:00', '19:00')], W, { ...ALL, breakDeduction: false }, NOW);
eq('회귀: 토글 OFF → 공제 0 · 유급 360', r.breakMin, 0); eq('회귀: 토글 OFF 유급분', r.paidMin, 360);
r = computePay([R('2026-07-01', '10:00', '15:00')], W, ALL, NOW);
eq('회귀: 1건짜리 근무는 값이 그대로(휴게 30)', r.breakMin, 30);
r = computePay([R('2026-07-01', '22:00', '06:00', '2026-07-02')], W, ALL, NOW);
eq('회귀: 자정 넘김 8h → 휴게 60 · 야간 480(날짜 귀속 규칙 불변)', r.breakMin, 60);
eq('회귀: 자정 넘김 nightMin', r.nightMin, 480);

// rmSync 재귀삭제는 Windows Node 24.x에서 네이티브 크래시(0xC0000409)로 15/15 PASS 후 exit 127 —
// 비동기 rm은 정상이라 이것만 사용(결과 출력을 정리보다 먼저).
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await rm(OUT, { recursive: true, force: true }).catch(() => {});
process.exit(fail ? 1 : 0);
