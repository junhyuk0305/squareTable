// industryRoutines.ts — 업종별 기본 루틴 선주입 데이터 (콜드스타트 슬라이스 A).
//
// 신규 매장은 schedule_config.dayparts 의 routines 가 전부 빈 배열이라 첫날 "오늘 할일"이
// 비어 있다(연료 문제). 온보딩이 이 시드를 1회 주입해 day-1부터 할일이 존재하게 한다.
// 주입 로직·가드(기존 루틴 있으면 no-op)는 useScheduleStore.seedDaypartRoutines 가 담당(SSOT).
//
// 범위: 카페 1업종 집중(기획 M14). 다른 업종은 팩이 생길 때 여기 항목만 늘리면 된다.
// 텍스트는 "할일 라벨"까지만 — 위생·정산의 상세 절차는 노하우팩(사람 검수)이 담당하고,
// 루틴은 무엇을 할지 이름만 부른다(부정확한 절차 선탑재로 신뢰를 깨지 않기 위함).

import { INDUSTRY_PACKS } from '@/data/knowhowPacks';

/** daypart id(open/mid/close/etc) → 기본 루틴 텍스트 목록 */
export type RoutineSeed = Record<string, string[]>;

const CAFE_ROUTINES: RoutineSeed = {
  open: [
    '매장 환기하고 조명·간판 켜기',
    '에스프레소 머신 예열·첫 추출 점검',
    '원두·우유·시럽 재고 확인',
    '테이블·바 닦고 오픈 준비',
  ],
  close: [
    '머신 청소(백플러시)·피처 세척',
    '남은 재료 밀봉·냉장 보관',
    '포스 마감·시재 정리',
    '쓰레기 배출·바닥 청소 후 소등',
  ],
};

/** 가입 업종 → 루틴 시드. 카페 팩 보유 업종만(나머지는 null = 주입 안 함). */
export function routineSeedForIndustry(industry: string | undefined): RoutineSeed | null {
  if (!industry) return null;
  return (INDUSTRY_PACKS[industry] ?? []).includes('cafe') ? CAFE_ROUTINES : null;
}
