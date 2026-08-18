#!/usr/bin/env node
// qa-knowhow-categories.mjs — 노하우 커스텀 카테고리 SSOT 회귀 가드.
//
// 왜 있나: 커스텀 카테고리(0096)는 기본 4종 외에 매장이 만든 종류를 schedule_config.knowhow_categories
//   jsonb 에 [{id,label}] 로 저장한다. 해석/정리 규칙(resolveCustomCategories·sanitizeCustomCategories)이
//   필터칩·종류 선택칩·편집 시트·getCategoryMeta 폴백에 두루 쓰이는 SSOT다. 특히 "기본 4종 키와의
//   id 충돌 금지"와 "빈 라벨 제거"가 무너지면 기본 카테고리가 덮이거나 유령 칩이 생긴다.
// 실행: node scripts/qa-knowhow-categories.mjs   (Node 24 type-strip 로 .ts 직접 import)
import {
  resolveCustomCategories,
  sanitizeCustomCategories,
  setCustomCategoryRegistry,
  getCustomCategoryRegistry,
  DEFAULT_CATEGORY_KEYS,
  CUSTOM_LABEL_MAX,
  pickCategoryColor,
} from '../src/lib/store/knowhowCategories.ts';

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, ok, extra = '') => { ok ? (pass++, console.log('  PASS', name, extra)) : (fail++, console.log('  FAIL', name, extra)); };

console.log('— resolveCustomCategories: 미설정/이물질 → 빈 배열 —');
for (const [name, input] of [['null', null], ['undefined', undefined], ['객체', {}], ['문자열', 'x'], ['숫자', 3]]) {
  check(`${name} → []`, eq(resolveCustomCategories(input), []));
}

console.log('— resolveCustomCategories: 정상/결손 항목 —');
check('정상 [{id,label}] 그대로', eq(resolveCustomCategories([{ id: 'kc_a', label: '배달앱' }]), [{ id: 'kc_a', label: '배달앱' }]));
check('빈/공백 라벨 제거', eq(resolveCustomCategories([{ id: 'kc_a', label: '  ' }, { id: 'kc_b', label: '재고' }]), [{ id: 'kc_b', label: '재고' }]));
check('id 없으면 결정적 인덱스 폴백', eq(resolveCustomCategories([{ label: '재고' }]), [{ id: 'kc_0', label: '재고' }]));
check('라벨 trim', eq(resolveCustomCategories([{ id: 'kc_a', label: ' 배달앱 ' }]), [{ id: 'kc_a', label: '배달앱' }]));
check(`라벨 ${CUSTOM_LABEL_MAX}자 초과 절단`, resolveCustomCategories([{ id: 'kc_a', label: 'x'.repeat(CUSTOM_LABEL_MAX + 5) }])[0].label.length === CUSTOM_LABEL_MAX);
check('이물질 항목(null/문자열) 건너뜀', eq(resolveCustomCategories([null, 'x', { id: 'kc_a', label: '재고' }]), [{ id: 'kc_a', label: '재고' }]));

console.log('— resolveCustomCategories: id 충돌 방어 —');
check('기본 4종 키를 커스텀 id로 위장 → 개명', (() => {
  const out = resolveCustomCategories([{ id: 'Routine', label: '가짜루틴' }]);
  return out.length === 1 && out[0].id !== 'Routine';
})());
check('중복 id → 뒤쪽 개명', (() => {
  const out = resolveCustomCategories([{ id: 'kc_a', label: '하나' }, { id: 'kc_a', label: '둘' }]);
  return out.length === 2 && out[0].id === 'kc_a' && out[1].id !== 'kc_a';
})());
check('결정적(같은 입력 → 같은 출력)', (() => {
  const input = [{ id: 'kc_a', label: '하나' }, { label: '둘' }];
  return eq(resolveCustomCategories(input), resolveCustomCategories(input));
})());

console.log('— sanitizeCustomCategories: 저장 직전 정리 —');
check('빈 라벨 제거', eq(sanitizeCustomCategories([{ id: 'kc_a', label: '' }, { id: 'kc_b', label: '재고' }]), [{ id: 'kc_b', label: '재고' }]));
check('전부 비면 빈 배열(기본 폴백 없음 — 기본 4종은 별도 고정)', eq(sanitizeCustomCategories([{ id: 'kc_a', label: ' ' }]), []));
check('기본 4종 키 충돌 시 새 id 발급', (() => {
  const out = sanitizeCustomCategories([{ id: 'Know-how', label: '가짜꿀팁' }]);
  return out.length === 1 && !DEFAULT_CATEGORY_KEYS.includes(out[0].id) && out[0].label === '가짜꿀팁';
})());
check('id 없는 신규 항목에 id 발급', (() => {
  const out = sanitizeCustomCategories([{ id: '', label: '재고' }]);
  return out.length === 1 && out[0].id.length > 0;
})());

console.log('— 색 보존 · pickCategoryColor —');
check('resolve: 저장된 색 보존', (() => {
  const out = resolveCustomCategories([{ id: 'kc_a', label: '배달앱', color: '#3E92D9' }]);
  return out.length === 1 && out[0].color === '#3E92D9';
})());
check('resolve: 이물질 색은 버린다(이름 해시 폴백에 맡김)', (() => {
  const out = resolveCustomCategories([{ id: 'kc_a', label: '배달앱', color: 'red' }, { id: 'kc_b', label: '포장', color: 7 }]);
  return out.every((c) => c.color === undefined);
})());
check('sanitize: 저장된 색 보존', (() => {
  const out = sanitizeCustomCategories([{ id: 'kc_a', label: '배달앱', color: '#F26A50' }]);
  return out[0].color === '#F26A50';
})());
check('pick: 안 쓰인 색만 고른다', (() => {
  const palette = ['#111111', '#222222', '#333333'];
  // 앞 둘이 이미 쓰였으면 남은 하나만 나와야 한다 — rand 를 어떻게 굴려도.
  return [0, 0.5, 0.99].every((r) => pickCategoryColor(palette, ['#111111', '#222222'], () => r) === '#333333');
})());
check('pick: 대소문자 달라도 같은 색으로 본다', (() => {
  const palette = ['#AABBCC', '#DDEEFF'];
  return pickCategoryColor(palette, ['#aabbcc'], () => 0) === '#DDEEFF';
})());
check('pick: 팔레트를 다 쓰면 그래도 하나 준다(빈 문자열 금지)', (() => {
  const palette = ['#111111', '#222222'];
  const got = pickCategoryColor(palette, palette, () => 0.99);
  return palette.includes(got);
})());
check('pick: rand=1 이어도 범위를 넘지 않는다', (() => {
  const palette = ['#111111', '#222222'];
  return palette.includes(pickCategoryColor(palette, [], () => 1));
})());
check('pick: 빈 팔레트는 빈 문자열', pickCategoryColor([], []) === '');

console.log('— 레지스트리 —');
setCustomCategoryRegistry([{ id: 'kc_a', label: '배달앱', color: '#3E92D9' }]);
check('set → get 반영(색 포함)', eq(getCustomCategoryRegistry(), [{ id: 'kc_a', label: '배달앱', color: '#3E92D9' }]));
setCustomCategoryRegistry([]);
check('초기화(매장 전환)', eq(getCustomCategoryRegistry(), []));

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
