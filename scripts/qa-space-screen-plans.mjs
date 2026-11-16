#!/usr/bin/env node
// qa-space-screen-plans.mjs — 공간 화면 판정 두 개의 진리표(2026-11-17 · 화면조립표 10절·11절).
//   firstStepPlan: 첫 5분 맨 아래 노란 버튼(다음 단계 이름) · 머리 뒤로(앞 단계 · 첫 단계만 나감).
//   spaceTeachPlan: 교육 탭 링크 카드(링크 0개면 없음) · 질문 0건 빈 상태의 다음 행동과 버튼 모양.
// 백엔드·AI 호출 0회. 실행: npm run qa:space-screen-plans   (Node 24 type-strip 로 .ts 직접 import)
import { firstStepPlan, spaceTeachPlan } from '../src/lib/place/screenPlans.ts';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} → ${g}${ok ? '' : ` (기대 ${w})`}`);
};

console.log('firstStepPlan');
check('① 노하우 쓰기: 버튼 = 직접 물어보기 · 뒤로 = 나감', firstStepPlan('write'), { dock: { kind: 'go', to: 'ask' }, back: null });
check('② 직접 물어보기: 버튼 = 링크 보내기 · 뒤로 = ①', firstStepPlan('ask'), { dock: { kind: 'go', to: 'link' }, back: 'write' });
check('③ 링크 보내기: 버튼 = 교육 링크 만들기 · 뒤로 = ②', firstStepPlan('link'), { dock: { kind: 'link' }, back: 'ask' });

console.log('spaceTeachPlan');
const T = (knowhow, links, linksOn = true) => spaceTeachPlan({ knowhow, links, linksOn });
check('노하우 0 · 링크 0 → 링크 카드 없음 · 노하우 쓰기 노랑', T(0, 0), { linkCard: false, emptyNext: 'write', emptyTone: 'yellow' });
check('노하우 0 · 링크 2 → 링크 카드 · 노하우 쓰기 보조', T(0, 2), { linkCard: true, emptyNext: 'write', emptyTone: 'secondary' });
check('노하우 3 · 링크 0 → 링크 카드 없음 · 교육 링크 만들기 노랑', T(3, 0), { linkCard: false, emptyNext: 'link', emptyTone: 'yellow' });
check('노하우 3 · 링크 1 → 링크 카드 · 빈 상태 버튼 없음', T(3, 1), { linkCard: true, emptyNext: null, emptyTone: 'secondary' });
check('스위치 꺼짐 · 노하우 3 · 링크 2 → 링크 카드 없음 · 버튼 없음', T(3, 2, false), { linkCard: false, emptyNext: null, emptyTone: 'yellow' });
check('스위치 꺼짐 · 노하우 0 → 노하우 쓰기 노랑', T(0, 0, false), { linkCard: false, emptyNext: 'write', emptyTone: 'yellow' });

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
