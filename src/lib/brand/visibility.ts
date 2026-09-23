// visibility.ts — 공개 수준(요약 / 노하우 공개 / 운영 공개)의 이름·설명 정본(기획정본 §4-A 표).
//
// 본사 설정 > 데이터 공개 안내와 점주 동의 화면·설정 > 본사 연결이 **같은 표**를 그린다 —
// 문구가 두 곳에서 어긋나면 점주가 동의한 것과 본사가 보는 것이 달라진다. 여기 한 곳만 고친다.
// 개인 축(급여·근태·직원 이름·개인 점수·채팅)은 어느 수준에도 없다 — 표에 "없음" 줄로 박아 둔다.
import type { BrandPayer, BrandRelation, BrandVisibility } from '@/lib/brand/brandDb';

export type VisibilityLevel = {
  key: BrandVisibility;
  label: string;
  /** 한 줄 요약 — 세그먼트·pill 아래 설명. */
  short: string;
  /** 본사가 보게 되는 것 — 동의 화면 경계표 본문. 앞 수준의 것을 **포함**한다. */
  sees: string[];
};

export const VISIBILITY_LEVELS: VisibilityLevel[] = [
  {
    key: 'summary',
    label: '요약',
    short: '매장 단위 숫자만',
    sees: ['연결 상태 · 요금 부담', '직원 수 · 노하우 수 · 미해결 질문 수', 'AI 사용량 · 본사 노하우 숙지율'],
  },
  {
    key: 'knowhow',
    label: '노하우 공개',
    short: '요약 + 매장 노하우 읽기',
    sees: ['요약의 전부', '매장이 직접 쓴 노하우 제목·본문(읽기만)'],
  },
  {
    key: 'ops',
    label: '운영 공개',
    short: '노하우 공개 + 운영 현황',
    sees: ['노하우 공개의 전부', '미해결 질문 내용(누가 물었는지는 없음)', '업무 완료 현황 · 매장 퀴즈 현황(매장 단위)'],
  },
];

/** 어느 수준에서도 본사에 가지 않는 것 — 스키마 수준에서 경로가 없다(brand-boundary 규칙). */
export const NEVER_SHARED = ['급여 · 시급 · 근태', '직원 이름 · 전화번호', '직원 개인별 점수 · 이수 기록', '업무 채팅'];

export const visibilityLabel = (v: BrandVisibility): string =>
  VISIBILITY_LEVELS.find((l) => l.key === v)?.label ?? v;

export const payerLabel = (p: BrandPayer): string => (p === 'brand' ? '본사 부담' : '매장 부담');

/**
 * 관계 이름(0223 · 정본 02 §2). 본사 표·드로어·점주 화면이 **같은 단어**를 쓴다 —
 * 한쪽만 '직영점'이고 다른 쪽이 '본사 직영'이면 같은 것을 두 개로 읽는다.
 */
export const relationLabel = (r: BrandRelation): string => (r === 'direct' ? '직영' : '가맹');

/** 표 필터·세그먼트의 순서 정본. '전체'는 화면이 앞에 붙인다. */
export const RELATIONS: { key: BrandRelation; label: string }[] = [
  { key: 'direct', label: '직영' },
  { key: 'franchise', label: '가맹' },
];

/** 연결 해제 사유 — 원장(brand_units.end_reason)에 그대로 남는다. 자유 입력은 받지 않는다. */
export const END_REASONS: { key: string; label: string }[] = [
  { key: 'contract_ended', label: '본사와 계약이 끝났어요' },
  { key: 'self_manage', label: '매장이 직접 관리할게요' },
  { key: 'privacy', label: '공개 범위가 부담돼요' },
  { key: 'other', label: '그 밖의 이유' },
];
