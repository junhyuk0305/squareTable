#!/usr/bin/env node
// qa-form-dirty.mjs — 저장하지 않은 값 판정(formDirty.ts) 케이스 표 · 순수 검사(2026-11-17 화면조립표 K-3 결함).
//   매장 기본 정보·내 정보 고치기가 이 판정으로 "나가기 전에 물을지"를 정한다.
// 백엔드·AI 호출 0회. 실행: node scripts/qa-form-dirty.mjs   (Node 24 type-strip 로 .ts 직접 import)
import { sameField, changedFields, askBeforeLeave } from '../src/lib/utils/formDirty.ts';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} → ${g}${ok ? '' : ` (기대 ${w})`}`);
};

console.log('sameField');
check('F1 같은 글자', sameField('09:00', '09:00'), true);
check('F2 다른 글자', sameField('09:00', '10:00'), false);
check('F3 앞뒤 빈칸만 다름 = 같음(저장 때 trim)', sameField('비고', ' 비고  '), true);
check('F4 null·빈 글자 = 같음', sameField(null, ''), true);
check('F5 undefined·빈 글자 = 같음', sameField(undefined, '  '), true);
check('F6 요일 순서만 다름 = 같음', sameField([1, 3], [3, 1]), true);
check('F7 요일 하나 더함 = 다름', sameField([1], [1, 2]), false);
check('F8 빈 목록끼리 = 같음', sameField([], []), true);
check('F9 목록과 글자 = 다름', sameField([], ''), false);
check('F10 켜짐·꺼짐 = 다름', sameField(true, false), false);

console.log('changedFields');
const saved = { open: '09:00', close: '22:00', closedDays: [0], note: '', bizNo: '123-45-67890' };
check('C1 그대로면 없음', changedFields(saved, { ...saved }), []);
check('C2 오픈 시각만 바꿈', changedFields(saved, { ...saved, open: '10:00' }), ['open']);
check('C3 휴무 순서만 바뀜 = 없음', changedFields({ ...saved, closedDays: [0, 6] }, { ...saved, closedDays: [6, 0] }), []);
check('C4 비고·번호 둘 다', changedFields(saved, { ...saved, note: '브레이크', bizNo: '' }), ['note', 'bizNo']);

console.log('askBeforeLeave');
check('A1 바뀐 칸 없음 = 묻지 않음', askBeforeLeave([], false), false);
check('A2 바뀐 칸 있음 = 묻는다', askBeforeLeave(['open'], false), true);
check('A3 저장 중 = 묻지 않음', askBeforeLeave(['open'], true), false);

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
