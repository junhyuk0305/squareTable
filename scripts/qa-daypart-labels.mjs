#!/usr/bin/env node
// qa-daypart-labels.mjs — 데이파트(시간대) 카테고리 + 루틴 SSOT 회귀 가드.
//
// 왜 있나: "시간대·루틴 설정"은 매장이 시간대 카테고리(오픈/미들/…)를 추가·삭제·수정하고, 카테고리마다
//   기본 루틴 업무를 등록하는 기능이다. 이 해석/정리 규칙(resolveDayparts·sanitizeDayparts)이 훅
//   (useDayparts/useDaypartLabels)·설정 시트·보드 파생에 두루 쓰이는 SSOT다. 특히 옛 버전이 이름만
//   {open,mid,close,etc} 객체로 저장했던 값과의 하위호환이 깨지면 기존 매장 설정이 사라진다.
//   이 스크립트가 진리표를 못박아 폴백/정규화/하위호환을 되돌리면 즉시 FAIL 한다.
// 실행: node scripts/qa-daypart-labels.mjs   (Node 24 type-strip 로 .ts 직접 import)
import {
  resolveDayparts,
  sanitizeDayparts,
  daypartLabelMap,
  defaultDayparts,
} from '../src/lib/store/daypartLabels.ts';

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, ok, extra = '') => { ok ? (pass++, console.log('  PASS', name, extra)) : (fail++, console.log('  FAIL', name, extra)); };

const ids = (dps) => dps.map((d) => d.id);
const labels = (dps) => dps.map((d) => d.label);
const DEF = defaultDayparts();

console.log('— resolveDayparts: 미설정 → 기본 4개 —');
for (const [name, input] of [['null', null], ['undefined', undefined], ['빈 객체', {}]]) {
  check(`${name} → 기본 4개`, eq(resolveDayparts(input), DEF));
}

console.log('— resolveDayparts: 레거시 {open,mid,close,etc} 객체 하위호환 —');
check('전부 커스텀 이름 → 4개 라벨 반영',
  eq(labels(resolveDayparts({ open: '아침', mid: '점심', close: '저녁', etc: '기타업무' })),
     ['아침', '점심', '저녁', '기타업무']));
check('레거시는 id 를 open/mid/close/etc 로 유지(기존 section 매칭)',
  eq(ids(resolveDayparts({ open: '아침' })), ['open', 'mid', 'close', 'etc']));
check('일부만 → 나머지 기본 라벨',
  eq(labels(resolveDayparts({ open: '오전조' })), ['오전조', '미들', '마감', '기타']));
check('빈/공백 라벨 → 기본으로 폴백',
  eq(labels(resolveDayparts({ open: '', mid: '   ', close: '\t', etc: '피크' })), ['오픈', '미들', '마감', '피크']));
check('레거시는 routines 빈 배열', resolveDayparts({ open: '아침' }).every((d) => Array.isArray(d.routines) && d.routines.length === 0));

console.log('— resolveDayparts: 신규 카테고리 배열 —');
const custom = [
  { id: 'open', label: '오픈', routines: [{ id: 'r1', text: '머신 예열' }, { id: 'r2', text: '쇼케이스 채우기' }] },
  { id: 'dp_break', label: '브레이크', routines: [] },
  { id: 'close', label: '마감', routines: [{ id: 'r3', text: '포스 정산' }] },
];
check('신규 배열 passthrough(순서·라벨 보존)', eq(ids(resolveDayparts(custom)), ['open', 'dp_break', 'close']));
check('루틴 텍스트 보존', eq(resolveDayparts(custom)[0].routines.map((r) => r.text), ['머신 예열', '쇼케이스 채우기']));
check('커스텀 카테고리도 그대로', eq(labels(resolveDayparts(custom)), ['오픈', '브레이크', '마감']));
check('빈 배열 → 기본 4개', eq(resolveDayparts([]), DEF));
check('id 누락 → 결정적 인덱스 폴백(dp_0…)',
  eq(ids(resolveDayparts([{ label: 'A' }, { label: 'B' }])), ['dp_0', 'dp_1']));
check('resolveDayparts 는 결정적(같은 입력 → 같은 출력)',
  eq(resolveDayparts([{ label: 'A' }]), resolveDayparts([{ label: 'A' }])));

console.log('— daypartLabelMap: id→label 조회 —');
check('라벨맵 폴백 포함',
  eq(daypartLabelMap(resolveDayparts(custom)), { open: '오픈', dp_break: '브레이크', close: '마감' }));

console.log('— sanitizeDayparts: 저장 직전 정리 —');
check('이름 없는 카테고리 제거',
  eq(labels(sanitizeDayparts([{ id: 'a', label: '오픈', routines: [] }, { id: 'b', label: '   ', routines: [] }])), ['오픈']));
check('라벨 앞뒤 공백 trim',
  eq(labels(sanitizeDayparts([{ id: 'a', label: '  브런치  ', routines: [] }])), ['브런치']));
check('빈/공백 루틴 제거 + 텍스트 trim',
  eq(sanitizeDayparts([{ id: 'a', label: '오픈', routines: [{ id: 'r1', text: ' 머신 예열 ' }, { id: 'r2', text: '  ' }, { id: 'r3', text: '' }] }])[0].routines.map((r) => r.text),
     ['머신 예열']));
check('전부 지우면 기본 4개로 복원',
  eq(sanitizeDayparts([{ id: 'a', label: '', routines: [] }]), DEF));
check('정상 카테고리+루틴 보존',
  eq(sanitizeDayparts([{ id: 'open', label: '오픈', routines: [{ id: 'r1', text: '예열' }] }]),
     [{ id: 'open', label: '오픈', routines: [{ id: 'r1', text: '예열' }] }]));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
