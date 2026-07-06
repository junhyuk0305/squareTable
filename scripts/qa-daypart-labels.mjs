#!/usr/bin/env node
// qa-daypart-labels.mjs — 데이파트 라벨 폴백 회귀 가드(회의 반영 기능).
//
// 왜 있나: "시간대 이름 설정"은 매장이 오픈/미들/마감/기타를 자기 이름으로 바꾸는 기능인데,
//   빈값·공백은 기본 이름으로 폴백해야 한다. 이 규칙이 훅(useDaypartLabels)과 저장부
//   (DaypartSettingsSheet)에 복제돼 있던 걸 resolveDaypartLabels 순수함수(SSOT)로 모았다.
//   이 스크립트가 진리표를 못박아 누가 폴백을 되돌리거나 한쪽만 바꾸면 즉시 FAIL 한다.
// 실행: node scripts/qa-daypart-labels.mjs   (Node 24 type-strip 로 .ts 직접 import)
import { resolveDaypartLabels, DEFAULT_DAYPART_LABELS } from '../src/lib/store/daypartLabels.ts';

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, ok, extra = '') => { ok ? (pass++, console.log('  PASS', name, extra)) : (fail++, console.log('  FAIL', name, extra)); };

const D = DEFAULT_DAYPART_LABELS;

// ── 미설정: null/undefined/빈객체 → 전부 기본 이름 ──
check('null → 기본 4개', eq(resolveDaypartLabels(null), D));
check('undefined → 기본 4개', eq(resolveDaypartLabels(undefined), D));
check('빈 객체 → 기본 4개', eq(resolveDaypartLabels({}), D));

// ── 전부 커스텀 → 그대로 반영 ──
check('전부 커스텀',
  eq(resolveDaypartLabels({ open: '아침', mid: '점심', close: '저녁', etc: '기타업무' }),
     { open: '아침', mid: '점심', close: '저녁', etc: '기타업무' }));

// ── 일부만 설정 → 나머지는 기본으로 폴백 ──
check('open만 커스텀 → 나머지 기본',
  eq(resolveDaypartLabels({ open: '오전조' }),
     { open: '오전조', mid: D.mid, close: D.close, etc: D.etc }));

// ── 핵심 폴백: 빈 문자열·공백만 입력은 기본으로(사장이 지웠을 때 빈 라벨이 뜨면 안 됨) ──
check('빈 문자열 → 해당 칸만 기본',
  eq(resolveDaypartLabels({ open: '', mid: '피크', close: '', etc: '' }),
     { open: D.open, mid: '피크', close: D.close, etc: D.etc }));
check('공백만 입력 → 기본으로 폴백(trim)',
  eq(resolveDaypartLabels({ open: '   ', mid: '\t', close: '\n', etc: ' ' }), D));

// ── 커스텀 값의 앞뒤 공백은 정리해서 저장/표시 ──
check('앞뒤 공백은 trim',
  eq(resolveDaypartLabels({ open: '  브런치  ', mid: 'x', close: 'y', etc: 'z' }),
     { open: '브런치', mid: 'x', close: 'y', etc: 'z' }));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
