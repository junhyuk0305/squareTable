// 업종 표준 노하우 팩 — 온보딩 자동등록의 데이터 소스.
// `knowhow-packs.json`은 `scripts/compile-pack.mjs`가 노하우팩/*.md에서 생성한다(직접 편집 금지).
// 사장 가입 업종 → 매칭되는 팩(common + 업종)의 템플릿을 체크리스트로 띄우고,
// 선택분을 forkTemplate으로 매장 노하우(PlaybookEntry)로 등록한다.

import type { PlaybookEntry } from '@/types';
import { genId } from '@/lib/utils/id';
import packsJson from './knowhow-packs.json';

// 번들 템플릿 = PlaybookEntry + 온보딩 전용 추천 플래그(추천 항목은 미리 체크됨, DB 컬럼 아님).
export type PlaybookTemplate = PlaybookEntry & { recommended?: boolean };

export const KNOWHOW_TEMPLATES = packsJson as unknown as PlaybookTemplate[];

// 가입 업종(signup.tsx INDUSTRIES) → 적용 팩. 1차 범위: 카페만 전용팩, 나머지는 공통으로 커버.
// (업종 전용팩은 추후 추가 — 매핑에 pack_id만 늘리면 자동 반영.)
export const INDUSTRY_PACKS: Record<string, string[]> = {
  '카페·디저트': ['common', 'cafe'],
  '음식점·식당': ['common'],
  '주점·바': ['common'],
  베이커리: ['common'],
  '분식·패스트푸드': ['common'],
  '편의점·소매': ['common'],
  '미용·뷰티': ['common'],
  기타: ['common'],
};

/** 업종에 매칭되는 템플릿 목록(추천 항목이 앞으로). 미지의 업종은 공통팩으로 폴백. */
export function templatesForIndustry(industry: string | undefined): PlaybookTemplate[] {
  const packs = INDUSTRY_PACKS[industry ?? ''] ?? ['common'];
  const set = new Set(packs);
  return KNOWHOW_TEMPLATES.filter((t) => set.has(t.pack_id ?? 'common')).sort(
    (a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)),
  );
}

/**
 * 템플릿 → 매장 노하우(PlaybookEntry) fork.
 * 새 id·매장/사장 바인딩·미확인(needs_review) 배지를 입히고, 온보딩 전용 recommended는 떨군다.
 * (recommended는 DB 컬럼이 아니라 insert 시 PostgREST가 거부 → 반드시 제거)
 */
export function forkTemplate(
  tpl: PlaybookTemplate,
  ctx: { unitId: string; creatorId: string; creatorName: string },
): PlaybookEntry {
  const { recommended: _omit, ...base } = tpl;
  const now = new Date().toISOString();
  return {
    ...base,
    id: genId('pb'),
    unit_id: ctx.unitId,
    creator_id: ctx.creatorId,
    creator_name: ctx.creatorName,
    is_template: false, // 이제 매장 실엔트리
    needs_review: true, // 사장이 교정 전 = '매장 기본값(미확인)'
    status: 'published',
    created_at: now,
    updated_at: now,
  };
}
