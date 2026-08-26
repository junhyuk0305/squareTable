#!/usr/bin/env node
// qa-shift-time.mjs — 근무 시각 판정(schedule.checkShiftTime)의 회귀 하네스.
//
// 왜: 계산(shiftMinutes·dayWindow·workers_at)은 처음부터 자정 넘김을 지원했는데 **입력 검사만**
//   `start < end` 로 막고 있어, 심야 매장은 밤 10시~새벽 2시 근무를 아예 넣을 수 없었다(감사 #43).
//   판정이 근무표 시트와 출퇴근 보정 두 곳에 복제돼 있던 것을 schedule.ts 한 곳으로 합쳤으므로,
//   그 한 곳을 못박는다. 백엔드를 쓰지 않는 순수 함수 게이트다(레이트 리밋 무관).
// 방식: qa-payroll 과 동일 — attendance.ts + schedule.ts 만 임시 트랜스파일해 실제 함수로 검증.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.shifttest');
try {
  execFileSync('npx', ['tsc',
    'src/lib/utils/attendance.ts', 'src/lib/utils/schedule.ts',
    '--outDir', '.shifttest', '--module', 'es2022', '--target', 'es2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0',
  ], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
} catch { /* tsc 는 성공해도 종종 비-0 경고 — 산출물 존재로 판정 */ }

const schedPath = join(OUT, 'schedule.js');
// tsc 가 남긴 확장자 없는 상대 import 를 ESM 이 읽을 수 있게 고친다(경로 별칭은 이 두 파일엔 없다).
writeFileSync(schedPath, readFileSync(schedPath, 'utf8').replace(/'@?\/?(\.\/)?(lib\/utils\/)?attendance'/g, "'./attendance.js'"), 'utf8');
writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');

const { checkShiftTime, isOvernight, shiftMinutes, addDays } = await import(pathToFileURL(schedPath));
const { nowISO, minutesBetween } = await import(pathToFileURL(join(OUT, 'attendance.js')));

let pass = 0, fail = 0;
const eq = (m, g, e) => { const ok = Object.is(g, e); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${m}: got=${JSON.stringify(g)} exp=${JSON.stringify(e)}`); ok ? pass++ : fail++; };
const ok = (m, cond, extra = '') => { cond ? (pass++, console.log('  PASS', m, extra)) : (fail++, console.log('  FAIL', m, extra)); };

// ── ① 자정 넘김은 유효하다 (수정 전 코드에서 RED 인 케이스) ──────────────
eq('① 22:00~02:00 유효(심야 근무)', checkShiftTime('22:00', '02:00'), null);
eq('① 23:30~00:30 유효(자정 직전 출근)', checkShiftTime('23:30', '00:30'), null);
eq('① 09:00~18:00 유효(주간 · 회귀)', checkShiftTime('09:00', '18:00'), null);

// ── ② 무효는 근무 0분뿐 ────────────────────────────────────────────────
ok('② 09:00~09:00 거부(근무 0분)', checkShiftTime('09:00', '09:00') !== null, `msg=${checkShiftTime('09:00', '09:00')}`);
ok('② 형식 오류 거부(9시)', checkShiftTime('9시', '18:00') !== null);
ok('② 형식 오류 거부(24:00)', checkShiftTime('09:00', '24:00') !== null);

// ── ③ 자정 넘김 판정 ───────────────────────────────────────────────────
eq('③ isOvernight(22:00,02:00)', isOvernight('22:00', '02:00'), true);
eq('③ isOvernight(09:00,18:00)', isOvernight('09:00', '18:00'), false);
eq('③ isOvernight(00:00,08:00)', isOvernight('00:00', '08:00'), false);

// ── ④ 길이 계산(회귀 — 원래 맞았다) ────────────────────────────────────
eq('④ shiftMinutes(22:00,02:00)=240', shiftMinutes('22:00', '02:00'), 240);
eq('④ shiftMinutes(09:00,18:00)=540', shiftMinutes('09:00', '18:00'), 540);

// ── ⑤ 기록 조립 — 퇴근이 다음 날로 넘어가야 근무분이 0 이 아니다 ────────
// upsertManual 이 하는 조립 그대로: 자정 넘김이면 퇴근만 다음 날짜로 붙인다.
const D = '2026-07-01';
const outDate = (ci, co) => (isOvernight(ci, co) ? addDays(D, 1) : D);
eq('⑤ 22:00~02:00 근무분=240', minutesBetween(nowISO(D, '22:00'), nowISO(outDate('22:00', '02:00'), '02:00')), 240);
eq('⑤ 09:00~18:00 근무분=540(회귀)', minutesBetween(nowISO(D, '09:00'), nowISO(outDate('09:00', '18:00'), '18:00')), 540);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await rm(OUT, { recursive: true, force: true }).catch(() => {});
process.exit(fail ? 1 : 0);
