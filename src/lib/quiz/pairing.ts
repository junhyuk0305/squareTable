// 훈련 퀴즈 v2 — 짝 판정 (t4 대응 ⑨뒤집기 flip_match · ⑩짝짓기 link_match 의 재료 찾기)
//
// t4 는 2026-08-08 에 멘트(action.scripts)를 지우면서 "짝을 만들 재료가 없어져" 폐기된 축이다.
// 여기서 재료를 새로 정의한다 — **짝 = 대상 ↔ 그 대상에만 해당하는 값**.
// 왼쪽(노하우 제목)을 보면 오른쪽(수치)이 하나로 정해져야 짝이다.
//
// ★ 혼동쌍(confusion.ts)과 **정확히 반대 방향의 게이트**다. 추출기(numericValues)도 임계값의
//   눈금(labelSimilarity 0.5)도 같은 것을 쓰고, 유사도 부등호만 뒤집는다:
//     · 혼동쌍   : 이름이 **비슷**하고 값이 다름 → "헷갈리는 둘 중 고르기"(scale_pick)
//     · 짝짓기   : 이름이 **구별**되고 값이 다름 → "각각 짝 찾기"(flip_match · link_match)
//   그래서 같은 노하우 무리가 두 형태로 동시에 새지 않는다 — 0.5 를 경계로 한쪽만 성립한다.
//
// ★ Math.random 없음. 정렬·동점 처리는 전부 id 로 한다 — 같은 노하우·같은 풀이면 같은 판이 나온다.
// ★ 억지로 만들지 않는다. 아래 조건 중 하나라도 어긋나면 null 이고, 호출부는 다른 형태로 간다.
//   조용히 이상한 문항이 나가는 것이 이 판정의 유일한 실패 모드다.

import { labelSimilarity } from '@/lib/rag';
import type { PlaybookEntry } from '@/types';
import { numericValues, type NumericValue } from './detect';
import { FORMATS } from './formats';
import { FLIP_MAX_PAIRS } from './formats/flipMatch';
import { LINK_MAX_PAIRS } from './formats/linkMatch';
import type { QuizFormat } from './types';

/**
 * 한 판의 최소 짝 수(조건 5). flipMatch.checkPairs 의 MIN_PAIRS 와 같은 값이어야 한다 —
 * 여기가 더 느슨하면 만들어 놓고 저장에서 튕기고, 더 빡빡하면 낼 수 있는 판을 안 낸다.
 * 2쌍이면 찍어서 50% 라 문항이 성립하지 않는다.
 */
export const PAIR_MIN = 3;

/**
 * 왼쪽 이름끼리 허용하는 유사도 **상한**(labelSimilarity 0~1). 이 값 **이상**인 쌍이 하나라도
 * 있으면 그 세트를 통째로 버린다.
 *
 * 근거: confusion.PAIR_SIM_MIN 과 같은 0.5 로 못 박는다 — 같은 눈금의 반대편이라 경계가 하나여야
 * 두 형태가 서로의 재료를 훔치지 않는다. 실제 문구로 재 보면:
 *   · "레귤러 시럽 양" vs "라지 시럽 양" → 토큰 {레귤러,시럽} ∩ {라지,시럽} = 1/2 = **0.50** → 버림
 *     (혼동쌍은 같은 0.50 을 하한으로 받아들인다. 정확히 맞물린다.)
 *   · "핫 아메리카노" vs "아이스 아메리카노" → 토큰 공유 "아메리카노" 1/1 = **1.00** → 버림
 *   · "카페라떼" vs "카페모카" → 2-gram Dice 2/6 = **0.33** → 통과
 *   · "아메리카노" vs "카페라떼" → 공유 없음 **0.00** → 통과
 * ⚠️ 파일럿 실사용 분포로 재보정 대상(knowhowSimilarity.ts 의 임계값들과 같은 성격).
 */
export const PAIR_NAME_SIM_MAX = 0.5;

/**
 * 카드 앞면에 들어갈 이름의 글자 수 상한.
 * 근거: 뒤집기 카드는 3열 그리드(FlipMatch.tsx card width 31% · numberOfLines 3 · fontSize 15).
 * 460px 프레임에서 카드 안쪽 폭이 약 116px → 15sp 한글 한 줄 약 7자 × 3줄 = 약 21자.
 * 그 이상은 "…" 로 잘려 무슨 카드인지 모르게 된다 → 그 노하우는 재료에서 뺀다(세트는 버리지 않는다).
 * 줄 잇기(LinkMatch)는 줄바꿈이 자유롭지만 같은 세트를 두 형태가 나눠 쓰므로 좁은 쪽에 맞춘다.
 */
export const PAIR_LEFT_MAX_CHARS = 20;

/** 짝 하나 = 노하우 한 건과 그 노하우에만 해당하는 값. */
export type PairMember = { entry: PlaybookEntry; left: string; value: number; unit: string };

/** 한 판. members 는 id 오름차순이고 전부 같은 unit·서로 다른 value 다. */
export type PairSet = { unit: string; members: PairMember[] };

/** 형태별 짝 수 상한. 한 판의 크기가 형태마다 다르다(뒤집기 6 · 줄 잇기 5). */
export const maxPairsOf = (format: QuizFormat): number =>
  format === 'link_match' ? LINK_MAX_PAIRS : FLIP_MAX_PAIRS;

const sectionKeyOf = (e: PlaybookEntry): string => String(e?.section ?? '').trim();
const leftOf = (e: PlaybookEntry): string => String(e?.title ?? '').trim();
const rightOf = (m: Pick<PairMember, 'value' | 'unit'>): string => `${m.value}${m.unit}`;

/**
 * 제목에 이미 그 값이 적혀 있나("아메리카노 2샷" ↔ "2샷"). 카드 앞면이 답을 말해 버리는 경우다.
 * ★ 판정을 새로 만들지 않는다 — 제목만 넣어 같은 추출기를 돌린다(한글 수 "두 샷"까지 같이 잡힌다).
 */
function leaksValue(left: string, v: NumericValue): boolean {
  return numericValues({ title: left }).some((x) => x.unit === v.unit && x.value === v.value);
}

/** 왼쪽 이름이 서로 구별되나(조건 4). 하나라도 걸리면 이 세트는 통째로 버린다. */
function namesDistinct(members: PairMember[]): boolean {
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (labelSimilarity(members[i].left, members[j].left) >= PAIR_NAME_SIM_MAX) return false;
    }
  }
  return true;
}

/**
 * seed 를 포함하는 짝 세트 1개. 없으면 null.
 *
 * 조건(전부 만족해야 한다):
 *   1. 같은 카테고리(section) 안에서만 모은다 — 섞이면 한 판이 한 주제로 안 읽힌다.
 *   2. 같은 단위의 수치를 가진다 — 단위가 다르면 단위만 보고 맞힐 수 있다.
 *   3. 값이 서로 전부 다르다 — 같은 값이 둘이면 정답이 둘이 되어 채점이 틀린다.
 *   4. 왼쪽 이름이 서로 구별된다 — 비슷하면 그건 혼동쌍(scale_pick)의 재료다.
 *   5. PAIR_MIN 건 이상이다.
 *
 * ★ 한 판이 한 번만 나오게 — 세트에서 **id 가 가장 작은 노하우가 seed 일 때만** 인정한다.
 *   quiz-new 는 코스에 담은 노하우를 하나씩 돌며 문항을 만들기 때문에, 이 규칙이 없으면
 *   같은 재료로 같은 판이 노하우 수만큼 반복해 나간다(confusion.ts 와 같은 규칙·같은 이유).
 */
function pairSetFor(
  seed: PlaybookEntry,
  pool: PlaybookEntry[],
  max: number,
  valuesOf: (e: PlaybookEntry) => NumericValue[],
): PairSet | null {
  const section = sectionKeyOf(seed);

  // ── 조건 1·2 — 같은 카테고리 안에서, 단위별로 모은다 ──────────────────────
  // 그 단위 값을 **정확히 하나** 가진 노하우만 담는다. 둘이면 "왼쪽을 보면 오른쪽이 하나로
  // 정해진다"가 깨져(3샷도 5샷도 맞다) 짝이 아니다.
  const byUnit = new Map<string, PairMember[]>();
  const seen = new Set<string>();
  for (const e of [seed, ...pool]) {
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    if (sectionKeyOf(e) !== section) continue;
    const left = leftOf(e);
    if (!left || left.length > PAIR_LEFT_MAX_CHARS) continue;
    const values = valuesOf(e);
    for (const unit of new Set(values.map((v) => v.unit))) {
      const hit = values.filter((v) => v.unit === unit);
      if (hit.length !== 1 || leaksValue(left, hit[0])) continue;
      const list = byUnit.get(unit);
      const member: PairMember = { entry: e, left, value: hit[0].value, unit };
      if (list) list.push(member);
      else byUnit.set(unit, [member]);
    }
  }

  // 후보가 많은 단위부터 본다 — 한 판이 커야 찍기가 안 통한다. 동점은 단위 이름순(결정성).
  const units = [...byUnit.keys()].sort((a, b) => {
    const d = (byUnit.get(b)?.length ?? 0) - (byUnit.get(a)?.length ?? 0);
    return d !== 0 ? d : (a < b ? -1 : 1);
  });

  for (const unit of units) {
    // ── 조건 3 — 값이 겹치면 정답이 둘이 된다. 겹친 값은 **양쪽 다** 뺀다(한쪽만 고르면 자의적이다).
    const all = byUnit.get(unit) ?? [];
    const times = new Map<number, number>();
    for (const m of all) times.set(m.value, (times.get(m.value) ?? 0) + 1);
    const members = all
      .filter((m) => times.get(m.value) === 1)
      .sort((a, b) => (a.entry.id < b.entry.id ? -1 : 1));

    // ── 조건 5 + 한 판 한 번 규칙
    if (members.length < PAIR_MIN || members[0].entry.id !== seed.id) continue;

    // 상한을 넘으면 앞에서 자른다(id 오름차순이라 seed 는 언제나 남는다).
    const shipped = members.slice(0, max);
    // ── 조건 4 — 실제로 내보낼 세트 안에서 이름이 서로 구별되어야 한다.
    if (!namesDistinct(shipped)) continue;

    return { unit, members: shipped };
  }
  return null;
}

/**
 * seeds 중 한 건을 축으로 하는 짝 세트 1개. 없으면 **null**.
 * @param max 한 판에 담을 짝 수 상한. 형태마다 다르다(maxPairsOf).
 */
export function findPairSet(
  seeds: PlaybookEntry[],
  pool: PlaybookEntry[],
  max = FLIP_MAX_PAIRS,
): PairSet | null {
  const cache = new Map<string, NumericValue[]>();
  const valuesOf = (e: PlaybookEntry): NumericValue[] => {
    let v = cache.get(e.id);
    if (!v) {
      v = numericValues(e);
      cache.set(e.id, v);
    }
    return v;
  };

  for (const seed of seeds) {
    if (!seed || !leftOf(seed)) continue;
    const set = pairSetFor(seed, pool, max, valuesOf);
    if (set) return set;
  }
  return null;
}

/**
 * 짝 세트 → 저장 payload. **AI 를 부르지 않는다** — 짝을 이미 다 알고 있어서 물어볼 게 없다.
 * (엣지를 거치면 캡을 1회 먹고, 모델이 우리가 고른 짝을 바꿔 놓을 수 있다. 왕복할 이유가 없다.)
 *
 * 오른쪽은 값+단위("3샷")이고 왼쪽은 노하우 제목이다. 두 형태의 payload 스키마가 같아서
 * (flipMatch.ts · linkMatch.ts 의 pairs) 문구만 형태에 맞춘다.
 */
export function buildMatchPayload(set: PairSet, format: QuizFormat): Record<string, any> {
  const verb = format === 'link_match' ? '이어' : '맞춰';
  return {
    ask: `각각 몇 ${set.unit}인지 ${verb} 주세요`,
    pairs: set.members.map((m) => ({ left: m.left, right: rightOf(m) })),
    explain: set.members.map((m) => `${m.left} ${rightOf(m)}`).join(' · '),
  };
}

/** 우리가 만든 t4 문항 재료. entries 는 근거 노하우(오답이 여기 전부에 귀속된다). */
export type PairPlan = { format: QuizFormat; entries: PlaybookEntry[]; payload: Record<string, any> };

/** t4 형태들(뒤집기·줄 잇기). 레지스트리가 SSOT — 여기에 형태 이름을 복제하지 않는다. */
const T4_FORMATS: QuizFormat[] = Object.values(FORMATS).filter((f) => f.kind === 't4').map((f) => f.key);

/**
 * 이 형태로 낼 수 있는 t4 문항 하나. 재료가 조건을 못 채우면 **null**(그게 유일한 게이트다).
 * 형태마다 짝 수 상한이 달라(6 vs 5) 형태를 먼저 알아야 세트를 만들 수 있다.
 */
export function pairPlanFor(format: QuizFormat, entries: PlaybookEntry[], pool: PlaybookEntry[]): PairPlan | null {
  const set = findPairSet(entries, pool, maxPairsOf(format));
  if (!set) return null;
  const payload = buildMatchPayload(set, format);
  // 레지스트리가 최종 관문 — 우리가 만든 payload 도 저장과 같은 잣대로 먼저 본다.
  if (FORMATS[format].validate(payload)) return null;
  return { format, entries: set.members.map((m) => m.entry), payload };
}

/**
 * 자동 출제용 t4 문항 하나. 형태(뒤집기/줄 잇기)는 seed 로 돌린다.
 *
 * ★ 회전축은 호출부가 넘기는 seed(노하우 id 해시 — generate.rotationSeed)다. Math.random 이 아니라서
 *   같은 노하우로 다시 만들면 같은 형태가 나온다.
 * ★ t4 에는 일반형 안전판이 없다(게임형 둘뿐). 그래서 여기서 null 이면 **t4 자체를 안 내는 것**이 답이다
 *   — 호출부의 유형 목록에는 t0(mc4) 이 언제나 남아 있어 갈 곳이 없어지지는 않는다.
 *   두 형태의 최소 짝 수는 둘 다 PAIR_MIN 이라 "조건은 맞는데 둘 다 못 만든다"는 상황은
 *   payload 가 검증에서 걸릴 때뿐이고, 그때도 같은 답(안 낸다)이다.
 */
export function pairPlan(entries: PlaybookEntry[], pool: PlaybookEntry[], seed: number): PairPlan | null {
  return pairPlanFor(T4_FORMATS[seed % T4_FORMATS.length], entries, pool);
}
