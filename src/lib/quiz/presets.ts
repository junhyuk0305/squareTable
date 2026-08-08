// 훈련 퀴즈 v2 — 기본 제공 코스 프리셋 (코드 SSOT)
//
// 계약: training-v2-contract.md §3 "기본 제공 프리셋".
// 프리셋은 **"바로 만들 수 있게 돕는 것"**이지 자동 생성이 아니다.
// 사장이 고르면 코스 행이 생기고, 어떤 업무를 담을지는 사장이 정한다.
// 단 코스를 만들 때 추천 업무를 제시한다 → recommendTemplates().
//
// ★ 순수 함수다. supabase·store·db 를 import 하지 않는다.

import type { PlaybookEntry } from '@/types';
import { detectKinds } from './detect';

export type QuizPresetKey = 'first_day' | 'regular' | 'short_term' | 'position';

export type QuizPreset = {
  key: QuizPresetKey;
  name: string;
  description: string;
  min_items: number;
  max_items: number;
  /** null = 1회성(한 번 통과하면 끝). N = N일마다 다시 확인. */
  due_days: number | null;
  /** 추천 업무를 왜 그렇게 골랐는지 — 사장 화면에 그대로 보여줄 한 줄. */
  recommendReason: string;
};

export const PRESETS: Record<QuizPresetKey, QuizPreset> = {
  first_day: {
    key: 'first_day',
    name: '첫 출근',
    description: '처음 온 날 이것만은',
    min_items: 3,
    max_items: 5,
    due_days: null,
    recommendReason: '노하우가 붙어 있고 금지·순서가 분명한 업무를 먼저 담았어요.',
  },
  regular: {
    key: 'regular',
    name: '정기 점검',
    description: '정해둔 주기마다 다시 확인',
    min_items: 3,
    max_items: 10,
    due_days: 30,
    recommendReason: '최근에 노하우가 바뀐 업무를 먼저 담았어요.',
  },
  short_term: {
    key: 'short_term',
    name: '단기·주말',
    description: '며칠만 일해도 사고 안 나게 — 금지 위주',
    min_items: 2,
    max_items: 4,
    due_days: null,
    recommendReason: '하면 안 되는 것이 적혀 있는 업무를 먼저 담았어요.',
  },
  position: {
    key: 'position',
    name: '포지션 바뀔 때',
    description: '홀↔주방처럼 자리가 바뀔 때',
    min_items: 3,
    max_items: 8,
    due_days: null,
    recommendReason: '상황에 따라 대응이 갈리는 업무를 먼저 담았어요.',
  },
};

/** 사장 화면에 보여줄 순서. */
export const PRESET_ORDER: QuizPresetKey[] = ['first_day', 'regular', 'short_term', 'position'];

/** 추천 계산에 필요한 업무 1건의 재료. 호출부(사장 화면)가 만들어 넘긴다. */
export type TemplateQuizContext = {
  templateId: string;
  templateName: string;
  /** 이 업무에 붙어 있는 노하우들. 없으면 빈 배열 — 문항을 만들 재료가 없다는 뜻이다. */
  entries: PlaybookEntry[];
  /** 이 업무에 이미 저장된 문항 수. 모르면 생략. 추천 순위에는 쓰지 않는다(인사이트용). */
  itemCount?: number;
};

function kindSetOf(entries: PlaybookEntry[]): Set<string> {
  const s = new Set<string>();
  for (const e of entries) for (const k of detectKinds(e)) s.add(k);
  return s;
}

function latestUpdatedAt(entries: PlaybookEntry[]): number {
  let max = 0;
  for (const e of entries) {
    const t = Date.parse(String(e?.updated_at ?? ''));
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

export function scoreFor(preset: QuizPresetKey, ctx: TemplateQuizContext, now: number): number {
  const entries = ctx.entries ?? [];
  // 노하우가 없으면 문항이 안 나온다. 추천에서 맨 뒤로 보내되 목록에서 지우지는 않는다
  // (사장이 "이 업무엔 노하우를 붙여야 하는구나"를 볼 수 있어야 한다).
  if (entries.length === 0) return -1;

  const kinds = kindSetOf(entries);
  const dontCount = entries.filter((e) => String(e?.square?.extract?.dont ?? '').trim()).length;
  const base = Math.min(entries.length, 3);

  switch (preset) {
    // 첫날은 "이것만은" — 사고로 이어지는 금지와, 틀리면 시간이 새는 순서가 핵심.
    case 'first_day':
      return base + (kinds.has('t3') ? 3 : 0) + (kinds.has('t1') ? 2 : 0);

    // 정기 점검은 "바뀐 것과 헷갈리는 것만 다시 본다" → 최근에 고쳐진 노하우가 붙은 업무 우선.
    case 'regular': {
      const days = (now - latestUpdatedAt(entries)) / 86_400_000;
      const fresh = days <= 30 ? 4 : days <= 90 ? 2 : 0;
      return base + fresh;
    }

    // 단기·주말은 금지 위주(계약 §3). dont 가 있는 노하우가 붙은 업무를 우선 제시한다.
    // 단계가 긴 업무는 며칠 일하는 사람에게 애초에 안 맡긴다 → 가볍게 감점.
    case 'short_term': {
      const heavy = entries.some((e) => (e?.square?.action?.steps ?? []).length > 5) ? 1 : 0;
      return dontCount * 4 - heavy;
    }

    // 자리가 바뀔 때 막히는 건 절차가 아니라 판단이다 — 갈래(t5)가 있는 업무 우선.
    case 'position':
      return base + (kinds.has('t5') ? 3 : 0);
  }
}

/**
 * 코스 행(training_courses)의 preset 문자열로 점수를 낸다 — 목록 정렬용 얇은 래퍼.
 * 계산은 scoreFor 그대로다(로직 무접촉). 사장이 직접 만든 코스는 preset 이 null 이라 기준이 없는데,
 * 그때는 'short_term'(= 금지가 적힌 업무 우선 = 사고 나는 자리)을 쓴다 — 모르면 사고부터 막는 게 안전하다.
 */
export function courseScoreFor(
  preset: string | null | undefined,
  ctx: TemplateQuizContext,
  now: number,
): number {
  return scoreFor(PRESET_ORDER.find((k) => k === preset) ?? 'short_term', ctx, now);
}

/**
 * 이 프리셋으로 코스를 만들 때 담을 만한 업무를 추천 순으로 돌려준다.
 *
 * 순수 함수 — 넘어온 ctx 배열을 그대로(같은 객체 참조로) 정렬·슬라이스해서 돌려주므로
 * 호출부는 templateName 을 바로 렌더하면 된다. 원본 배열은 건드리지 않는다.
 *
 * @param limit 기본값 = PRESETS[preset].max_items
 */
export function recommendTemplates(
  preset: QuizPresetKey,
  ctx: TemplateQuizContext[],
  limit?: number,
): TemplateQuizContext[] {
  const now = Date.now();
  const max = limit ?? PRESETS[preset].max_items;
  return [...(ctx ?? [])]
    .map((c) => ({ c, s: scoreFor(preset, c, now) }))
    // 동점은 업무 이름으로 갈라 매번 같은 순서가 나오게 한다(결정적).
    .sort((a, b) => (b.s - a.s) || a.c.templateName.localeCompare(b.c.templateName, 'ko'))
    .slice(0, Math.max(0, max))
    .map((x) => x.c);
}
