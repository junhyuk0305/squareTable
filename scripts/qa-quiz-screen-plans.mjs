#!/usr/bin/env node
// qa-quiz-screen-plans.mjs — 퀴즈 화면 판정의 케이스 표(2026-11-17 · 화면조립표 11절 1·2·3·4번).
//   trainingMakeEntry: 퀴즈 탭 만들기 입구(떠 있는 노란 알약 · 0개면 카드 노란 버튼 · 노하우 0이면 노하우 추가).
//   quizNewDock·quizNewBack: 퀴즈 만들기 맨 아래 노란 버튼 하나(이름 = 다음 단계 이름) · 머리 뒤로(앞 단계).
//   linkQuizNav: 링크로 퀴즈 풀기의 주 버튼 이름("n번 문제" · 마지막 = 제출하기) · 뒤로(앞 문항).
//   quizDetailSeg·quizResultTop: 퀴즈 상세 칸 고르기 처음 값 · 결과 칸 맨 위 다시 알리기.
// 백엔드·AI 호출 0회. 실행: npm run qa:quiz-screen-plans   (Node 24 type-strip 로 .ts 직접 import)
import { trainingMakeEntry, quizNewDock, quizNewBack, linkQuizNav, quizDetailSeg, quizResultTop } from '../src/lib/utils/quizScreenPlans.ts';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} → ${g}${ok ? '' : ` (기대 ${w})`}`);
};
const BANNED = /다음|확인|완료/;

console.log('trainingMakeEntry');
check('① 퀴즈 3 · 노하우 5 = 떠 있는 알약', trainingMakeEntry({ quizzes: 3, usable: 5 }), 'fab');
check('② 퀴즈 0 · 노하우 5 = 카드 노란 버튼(떠 있는 버튼 없음)', trainingMakeEntry({ quizzes: 0, usable: 5 }), 'card');
check('③ 퀴즈 0 · 노하우 0 = 노하우 추가', trainingMakeEntry({ quizzes: 0, usable: 0 }), 'knowhow');
check('④ 퀴즈 2 · 노하우 0 = 노하우 추가(만들 재료 없음)', trainingMakeEntry({ quizzes: 2, usable: 0 }), 'knowhow');

console.log('quizNewDock');
const base = { audience: 'staff', picked: 0, okItems: 0, to: 0, sendNow: true, busy: false, ready: true };
check('① 1단계 = 노하우 고르기 → 2', quizNewDock({ ...base, step: 1 }), { kind: 'go', to: 2, label: '노하우 고르기', disabled: false });
check('② 1단계 재료 덜 옴 = 못 누름', quizNewDock({ ...base, step: 1, ready: false }).disabled, true);
check('③ 2단계 0개 = 못 누름', quizNewDock({ ...base, step: 2 }), { kind: 'make', label: '노하우를 골라 주세요', disabled: true });
check('④ 2단계 3개 = 3개로 문제 만들기', quizNewDock({ ...base, step: 2, picked: 3 }), { kind: 'make', label: '3개로 문제 만들기', disabled: false });
check('⑤ 3단계(만드는 중) = 버튼 없음', quizNewDock({ ...base, step: 3 }), null);
check('⑥ 4단계 문항 0 = 노하우 다시 고르기 → 2', quizNewDock({ ...base, step: 4 }), { kind: 'go', to: 2, label: '노하우 다시 고르기', disabled: false });
check('⑦ 4단계 직원용 = 받는 사람 고르기 → 5', quizNewDock({ ...base, step: 4, okItems: 2 }), { kind: 'go', to: 5, label: '받는 사람 고르기', disabled: false });
check('⑧ 4단계 외부용 = 링크 기간 정하기 → 5', quizNewDock({ ...base, step: 4, okItems: 2, audience: 'guest' }), { kind: 'go', to: 5, label: '링크 기간 정하기', disabled: false });
check('⑨ 5단계 직원 3명 바로', quizNewDock({ ...base, step: 5, to: 3 }), { kind: 'publish', label: '3명에게 보내기', disabled: false });
check('⑩ 5단계 직원 3명 예약', quizNewDock({ ...base, step: 5, to: 3, sendNow: false }).label, '3명에게 예약하기');
check('⑪ 5단계 직원 0명 = 못 누름', quizNewDock({ ...base, step: 5 }).disabled, true);
check('⑫ 5단계 외부용 = 링크 만들기(받는 사람 없어도 됨)', quizNewDock({ ...base, step: 5, audience: 'guest' }), { kind: 'publish', label: '링크 만들기', disabled: false });
check('⑬ 5단계 보내는 중 = 못 누름', quizNewDock({ ...base, step: 5, to: 3, busy: true }), { kind: 'publish', label: '보내는 중…', disabled: true });
check('⑭ 6(링크 만든 뒤) = 링크 복사', quizNewDock({ ...base, step: 6 }), { kind: 'copy' });
{
  const labels = [];
  for (const step of [1, 2, 4, 5]) for (const audience of ['staff', 'guest']) for (const okItems of [0, 2]) for (const picked of [0, 2]) {
    const d = quizNewDock({ ...base, step, audience, okItems, picked, to: 2 });
    if (d && 'label' in d) labels.push(d.label);
  }
  check('⑮ 어느 단계에도 "다음"·"확인"·"완료" 없음', labels.filter((l) => BANNED.test(l)), []);
}

console.log('quizNewBack');
check('① 1단계 = 나감', quizNewBack(1), null);
check('② 2단계 = 1', quizNewBack(2), 1);
check('③ 3단계(만드는 중) = 나감', quizNewBack(3), null);
check('④ 4단계 = 2(만드는 중은 건너뜀)', quizNewBack(4), 2);
check('⑤ 5단계 = 4', quizNewBack(5), 4);
check('⑥ 6(링크 만든 뒤) = 나감', quizNewBack(6), null);

console.log('linkQuizNav');
check('① 3문제 중 첫째 = 2번 문제 · 뒤로 없음', linkQuizNav(0, 3, 3), { primary: { kind: 'go', to: 1, label: '2번 문제' }, back: null });
check('② 둘째 = 3번 문제 · 뒤로 = 첫째', linkQuizNav(1, 3, 1), { primary: { kind: 'go', to: 2, label: '3번 문제' }, back: 0 });
check('③ 마지막 · 1개 풂 = 제출하기', linkQuizNav(2, 3, 2), { primary: { kind: 'submit', label: '제출하기', disabled: false }, back: 1 });
check('④ 마지막 · 하나도 안 풂 = 못 냄', linkQuizNav(2, 3, 3).primary.disabled, true);
check('⑤ 1문제뿐 = 제출하기 · 뒤로 없음', linkQuizNav(0, 1, 0), { primary: { kind: 'submit', label: '제출하기', disabled: false }, back: null });

console.log('quizDetailSeg · quizResultTop');
check('① ?tab=settings = 설정', quizDetailSeg('settings'), 'settings');
check('② ?tab=items = 문항', quizDetailSeg('items'), 'items');
check('③ ?tab=result = 결과', quizDetailSeg('result'), 'people');
check('④ 모르는 값·없음 = 결과', [quizDetailSeg('x'), quizDetailSeg(undefined)], ['people', 'people']);
check('⑤ 안 푼 2명 = 다시 알리기 문구', quizResultTop(2), { resendLabel: '아직 안 푼 2명에게 다시 알리기' });
check('⑥ 0명 = 버튼 없음', quizResultTop(0), null);

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
