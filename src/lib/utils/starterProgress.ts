// starterProgress.ts — 사장 허브 "시작 체크리스트" 판정 SSOT (콜드스타트 슬라이스 A).
//
// 신규 매장의 허브 현황 탭은 첫날 0뿐이라 죽은 화면이다. 이 util이 owner_overview(0086)
// 한 행에서 4단계 진행을 파생하고, 화면(StarterChecklist)은 렌더만 한다 — 판정을 화면·스토어에
// 복제하지 말 것(AGENTS ② 규칙 SSOT).
//
// 판정 원칙:
//  · 전부 서버 집계(ever-스코프 플래그 포함) 파생 — 로컬 저장 없음(기기 바뀌어도 유지).
//  · "AI에 첫 질문"을 ai_used(월간)로 판정 금지 — KST 월 리셋으로 성숙 매장에 매월 부활한다.
//  · 0을 위험으로 표시하지 않는다 — 이 카드 자체가 "곧 채워질 자리" 안내다(콜드스타트 3원칙).

import type { OwnerOverviewRow } from '@/lib/db';

export type StarterStepId = 'knowhow' | 'ask' | 'invite' | 'task';

export type StarterStep = {
  id: StarterStepId;
  /** 행 제목(명사형) */
  title: string;
  /** 미완료 행 하단 안내(서술형·~해요체) */
  hint: string;
  done: boolean;
};

/** 한 매장의 시작 4단계 — 순서 = 권장 진행 순서(담기 → 질문 → 초대 → 할일). */
export function starterSteps(row: OwnerOverviewRow): StarterStep[] {
  return [
    {
      id: 'knowhow',
      title: '노하우 담기',
      hint: '업종 추천 노하우를 한 번에 담을 수 있어요',
      done: row.knowhow > 0,
    },
    {
      id: 'ask',
      title: 'AI에 첫 질문',
      hint: '담아둔 노하우로 어떻게 답하는지 직접 확인해 보세요',
      // !! = 0086 미적용 백엔드(구버전 RPC)에서 undefined 방어 — 클라 배포가 DB보다 앞서도 안 터진다.
      done: !!row.asked_ever,
    },
    {
      id: 'invite',
      title: '직원 초대',
      hint: '직원이 초대코드로 신청하면 사장님이 승인해요',
      done: row.staff > 0,
    },
    {
      id: 'task',
      title: '첫 할일 완료',
      hint: '오늘 할일을 하나 완료하면 매장 기록이 쌓이기 시작해요',
      done: !!row.done_ever,
    },
  ];
}

/** 4단계 모두 완료 = 졸업(카드 소멸). 플래그가 전부 단조 증가라 졸업은 사실상 영구다. */
export function starterGraduated(row: OwnerOverviewRow): boolean {
  return starterSteps(row).every((s) => s.done);
}
