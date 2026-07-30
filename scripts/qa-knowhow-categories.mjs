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

console.log('— 레지스트리 —');
setCustomCategoryRegistry([{ id: 'kc_a', label: '배달앱' }]);
check('set → get 반영', eq(getCustomCategoryRegistry(), [{ id: 'kc_a', label: '배달앱' }]));
setCustomCategoryRegistry([]);
check('초기화(매장 전환)', eq(getCustomCategoryRegistry(), []));

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
