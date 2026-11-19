#!/usr/bin/env node
// qa-step-screen-plans.mjs — 매장 단계 화면 네 곳의 판정 케이스 표(2026-11-17 · 화면조립표 11절 3번).
//   맨 아래 고정 노란 버튼 하나(이름 = 다음 단계 이름 · 일을 끝내는 단계는 그 일 이름) · 머리·안드 뒤로 = 앞 단계.
// 백엔드·AI 호출 0회. 실행: node scripts/qa-step-screen-plans.mjs   (Node 24 type-strip 로 .ts 직접 import)
import { importKnowhowPlan, handoverPlan, ownerFirstPlan, ownerFirstAfterWrite, ownerWritePlan, ownerFivePlan, downgradePlan } from '../src/lib/utils/stepScreenPlans.ts';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} → ${g}${ok ? '' : ` (기대 ${w})`}`);
};

console.log('importKnowhowPlan · 노하우 복사하기');
check('① 매장 둘 다 고름: 노하우 고르기 · 나감', importKnowhowPlan(1, { picked: true, selected: 0 }), { dock: { label: '노하우 고르기', disabled: false }, back: null });
check('① 덜 고름: 버튼 꺼짐', importKnowhowPlan(1, { picked: false, selected: 0 }).dock.disabled, true);
check('② 3개 고름: 3개 복사하기 · 뒤로 = ①', importKnowhowPlan(2, { picked: true, selected: 3 }), { dock: { label: '3개 복사하기', disabled: false }, back: 1 });
check('② 0개: 꺼짐', importKnowhowPlan(2, { picked: true, selected: 0 }), { dock: { label: '노하우를 골라 주세요', disabled: true }, back: 1 });
check('③ 복사한 뒤: 끝내기 · 뒤로 = 나감(복사는 되돌릴 수 없음)', importKnowhowPlan(3, { picked: true, selected: 3 }), { dock: { label: '끝내기', disabled: false }, back: null });

console.log('handoverPlan · 문서로 한꺼번에 추가');
check('붙여넣기: AI로 노하우 정리하기 · 나감', handoverPlan('input', { tooShort: false, extracting: false, chosen: 0 }), { dock: { label: 'AI로 노하우 정리하기', disabled: false }, back: null });
check('붙여넣기 짧음: 꺼짐', handoverPlan('input', { tooShort: true, extracting: false, chosen: 0 }).dock.disabled, true);
check('PDF 읽는 중: 꺼짐', handoverPlan('input', { tooShort: false, extracting: true, chosen: 0 }).dock.disabled, true);
check('정리 중: 버튼 없음 · 나감', handoverPlan('processing', { tooShort: false, extracting: false, chosen: 0 }), { dock: null, back: null });
check('고르기 2개: 노하우 2개 추가하기 · 뒤로 = 붙여넣기', handoverPlan('review', { tooShort: true, extracting: false, chosen: 2 }), { dock: { label: '노하우 2개 추가하기', disabled: false }, back: 'input' });
check('고르기 0개: 꺼짐', handoverPlan('review', { tooShort: true, extracting: false, chosen: 0 }).dock.disabled, true);

console.log('ownerFirstPlan · 사장 첫 노하우 담기(옛 순서)');
check('고르기 5개: 5개 우리 매장에 담기 · 나감', ownerFirstPlan('pick', { selected: 5, registering: false, registered: 0, wrote: 0 }), { dock: { label: '5개 우리 매장에 담기', disabled: false }, back: null });
check('담는 중: 꺼짐', ownerFirstPlan('pick', { selected: 5, registering: true, registered: 0, wrote: 0 }).dock, { label: '담는 중…', disabled: true });
check('첫 질문: 버튼은 OwnerFirstAsk 가 든다 · 담은 뒤라 고르기로 안 감', ownerFirstPlan('ask', { selected: 5, registering: false, registered: 5, wrote: 0 }), { dock: null, back: null });
check('초대코드(담음): 뒤로 = 첫 질문', ownerFirstPlan('done', { selected: 5, registering: false, registered: 5, wrote: 0 }).back, 'ask');
check('초대코드(둘 다 건너뜀): 뒤로 = 쓰기', ownerFirstPlan('done', { selected: 0, registering: false, registered: 0, wrote: 0 }).back, 'write');
check('초대코드(쓰기만 담음): 뒤로 = 첫 질문', ownerFirstPlan('done', { selected: 0, registering: false, registered: 0, wrote: 1 }).back, 'ask');
check('쓰기(담은 뒤): 버튼은 OwnerWriteOwnStep 이 든다 · 고르기로 안 감', ownerFirstPlan('write', { selected: 5, registering: false, registered: 5, wrote: 0 }), { dock: null, back: null });
check('쓰기(고르기 건너뜀): 뒤로 = 고르기', ownerFirstPlan('write', { selected: 0, registering: false, registered: 0, wrote: 0 }).back, 'pick');
check('쓰기 건너뜀(담은 것 있음): 첫 질문', ownerFirstAfterWrite({ registered: 5, wrote: 0 }), 'ask');
check('쓰기 건너뜀(0개): 첫 질문도 건너뛰고 초대코드', ownerFirstAfterWrite({ registered: 0, wrote: 0 }), 'done');

console.log('ownerWritePlan · 우리 매장 방식 한 줄 쓰기');
check('빈 칸: 정리해서 담기 · 꺼짐', ownerWritePlan({ saved: false, busy: false, hasText: false, nextLabel: 'AI에게 물어보기' }), { label: '정리해서 담기', disabled: true });
check('씀: 켜짐', ownerWritePlan({ saved: false, busy: false, hasText: true, nextLabel: 'AI에게 물어보기' }).disabled, false);
check('정리 중: 꺼짐', ownerWritePlan({ saved: false, busy: true, hasText: true, nextLabel: 'AI에게 물어보기' }).disabled, true);
check('담은 뒤: 다음 단계 이름', ownerWritePlan({ saved: true, busy: false, hasText: false, nextLabel: 'AI에게 물어보기' }), { label: 'AI에게 물어보기', disabled: false });

console.log('ownerFivePlan · 사장 첫 5분(새 순서)');
check('초대: 우리 매장 방식 쓰기 · 나감', ownerFivePlan('invite', { startAtAsk: false }), { dock: { label: 'write' }, back: null });
check('쓰기: 버튼은 OwnerWriteOwnStep 이 든다 · 뒤로 = 초대', ownerFivePlan('write', { startAtAsk: false }), { dock: null, back: 'invite' });
check('질문: 끝내기 · 뒤로 = 쓰기', ownerFivePlan('ask', { startAtAsk: false }), { dock: { label: 'finish' }, back: 'write' });
check('허브에서 바로 질문: 현황으로 돌아가기 · 나감', ownerFivePlan('ask', { startAtAsk: true }), { dock: { label: 'backToHub' }, back: null });

console.log('downgradePlan · 요금제 낮추기');
check('세 갈래: 버튼 없음 · 나감', downgradePlan('fork', { pickedStore: false, seats: 0, busy: false }), { dock: null, back: null });
check('매장: 이 매장 남기기 · 뒤로 = 세 갈래', downgradePlan('store', { pickedStore: true, seats: 0, busy: false }), { dock: { label: '이 매장 남기기', disabled: false }, back: 'fork' });
check('매장 안 고름: 꺼짐', downgradePlan('store', { pickedStore: false, seats: 0, busy: false }).dock.disabled, true);
check('직원 2명: 2명 남기기 · 뒤로 = 세 갈래', downgradePlan('seats', { pickedStore: true, seats: 2, busy: false }), { dock: { label: '2명 남기기', disabled: false }, back: 'fork' });
check('직원 0명: 남길 직원 고르기 · 꺼짐', downgradePlan('seats', { pickedStore: true, seats: 0, busy: false }).dock, { label: '남길 직원 고르기', disabled: true });

const all = [importKnowhowPlan(1, { picked: true, selected: 0 }), importKnowhowPlan(2, { picked: true, selected: 1 }), importKnowhowPlan(3, { picked: true, selected: 1 }),
  handoverPlan('input', { tooShort: false, extracting: false, chosen: 0 }), handoverPlan('review', { tooShort: false, extracting: false, chosen: 1 }),
  ownerFirstPlan('pick', { selected: 1, registering: false, registered: 0, wrote: 0 }), ownerFirstPlan('done', { selected: 1, registering: false, registered: 1, wrote: 0 }),
  { dock: ownerWritePlan({ saved: false, busy: false, hasText: true, nextLabel: '' }) },
  downgradePlan('store', { pickedStore: true, seats: 0, busy: false }), downgradePlan('seats', { pickedStore: true, seats: 1, busy: false })]
  .map((p) => p.dock?.label ?? '');
check('버튼 이름에 다음·확인·완료 없음', all.filter((l) => /다음|확인|완료/.test(l)), []);

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
