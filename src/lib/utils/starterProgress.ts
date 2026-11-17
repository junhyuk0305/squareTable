// starterProgress.ts — 사장 "시작하기" 카드 판정 SSOT. 사장 매장 홈과 사장 허브가 같이 쓴다(2026-11-17 화면 조립표 2차 0번).
//
// 이 util이 owner_overview(0086 · 0840) 한 행에서 4단계 진행을 파생하고, 화면(StarterChecklist)은 렌더만 한다 — 판정을 화면·스토어에
// 복제하지 말 것(AGENTS ② 규칙 SSOT).
//
// 판정 원칙:
//  · 전부 서버 집계 파생 — 로컬 저장 없음(기기 바뀌어도 유지).
//  · 단계 넷, 이 순서: 노하우 담기 → 직원 초대 → 첫 할일 등록 → 첫 퀴즈 보내기.
//    "AI에 첫 질문"(asked_ever)과 "첫 할일 완료"(done_ever)는 뺐다. 사장은 질문을 할 수 없다(10절 5번).
//  · 첫 퀴즈 = 배정이나 링크가 있어야 끝이다. 만들기만 한 퀴즈는 아니다(0840 머리말).
//  · 0을 위험으로 표시하지 않는다 — 이 카드 자체가 "곧 채워질 자리" 안내다(콜드스타트 3원칙).

import type { OwnerOverviewRow } from '@/lib/db';

export type StarterStepId = 'knowhow' | 'invite' | 'task' | 'quiz';

export type StarterStep = {
  id: StarterStepId;
  /** 행 제목(명사형) */
  title: string;
  /** 지금 할 단계 행 아래 안내(서술형·~해요체) */
  hint: string;
  done: boolean;
};

/** 시작 카드가 읽는 칸만. 홈은 이 매장 한 행, 허브는 매장 1곳일 때 그 행을 넘긴다. */
export type StarterRow = Pick<OwnerOverviewRow, 'knowhow' | 'staff' | 'task_added_ever' | 'quiz_sent_ever'>;

/** 한 매장의 시작 4단계 — 순서 = 권장 진행 순서. */
export function starterSteps(row: StarterRow): StarterStep[] {
  return [
    {
      id: 'knowhow',
      title: '노하우 담기',
      hint: '업종 추천 노하우를 한 번에 담을 수 있어요',
      done: Number(row.knowhow) > 0,
    },
    {
      id: 'invite',
      title: '직원 초대',
      hint: '직원이 초대코드로 신청하면 사장님이 승인해요',
      done: Number(row.staff) > 0,
    },
    {
      id: 'task',
      title: '첫 할일 등록',
      hint: '할일을 적으면 직원 홈에 떠요',
      // !! = 0840 미적용 백엔드(옛 서버)에서 칸이 없다 — 클라 배포가 DB보다 앞서도 안 터진다.
      done: !!row.task_added_ever,
    },
    {
      id: 'quiz',
      title: '첫 퀴즈 보내기',
      hint: '담은 노하우로 퀴즈를 만들어 직원에게 보내요',
      done: !!row.quiz_sent_ever,
    },
  ];
}

/** 지금 할 단계 = 위에서 처음 안 끝난 단계. 다 끝났으면 null. 노란 버튼은 이 단계에만 단다. */
export function starterNextId(row: StarterRow): StarterStepId | null {
  return starterSteps(row).find((s) => !s.done)?.id ?? null;
}

/** 4단계 모두 완료 = 졸업(카드 소멸). */
export function starterGraduated(row: StarterRow): boolean {
  return starterNextId(row) === null;
}
