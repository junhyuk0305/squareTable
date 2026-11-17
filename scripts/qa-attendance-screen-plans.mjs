#!/usr/bin/env node
// qa-attendance-screen-plans.mjs — 출근 기록 화면 판정 케이스 표(2026-11-17 · 화면조립표 11절 2번·4번).
//   timesheetPlan: 칸 고르기 숫자 · 떠 있는 노란 [출근 기록 추가] · 0개일 때 빈 상태 노란 버튼.
// 백엔드·AI 호출 0회. 실행: npm run qa:attendance-screen-plans   (Node 24 type-strip 로 .ts 직접 import)
import { timesheetPlan } from '../src/lib/utils/attendanceScreenPlans.ts';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} → ${g}${ok ? '' : ` (기대 ${w})`}`);
};
const base = { tab: 'records', monthReady: true, records: 4, mismatches: 1, adding: false };

console.log('timesheetPlan');
check('① 기록 4 · 다른 날 1: 숫자 그대로 · 떠 있는 버튼', timesheetPlan(base), { counts: { records: 4, mismatch: 1 }, fab: true, emptyAdd: false });
check('② 기록 0: 떠 있는 버튼 없음 · 빈 상태 노란 버튼', timesheetPlan({ ...base, records: 0 }), { counts: { records: 0, mismatch: 1 }, fab: false, emptyAdd: true });
check('③ 추가 칸이 열림: 둘 다 없음', timesheetPlan({ ...base, adding: true }), { counts: { records: 4, mismatch: 1 }, fab: false, emptyAdd: false });
check('④ 다른 날 칸: 둘 다 없음', timesheetPlan({ ...base, tab: 'mismatch' }), { counts: { records: 4, mismatch: 1 }, fab: false, emptyAdd: false });
check('⑤ 달을 다 읽기 전: 숫자 0 · 둘 다 없음', timesheetPlan({ ...base, monthReady: false }), { counts: { records: 0, mismatch: 0 }, fab: false, emptyAdd: false });
check('⑥ 기록 0 · 다른 날 칸: 빈 상태 버튼 없음', timesheetPlan({ ...base, records: 0, tab: 'mismatch' }), { counts: { records: 0, mismatch: 1 }, fab: false, emptyAdd: false });

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
