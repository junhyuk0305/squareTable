// 필수성 판정 — "이 노하우를 모르면 안 되나"를 재는 rubric (2026-08-24, 작업 G)
//
// ══════════════════════════════════════════════════════════════════════════
// 왜 이게 있나
// ══════════════════════════════════════════════════════════════════════════
// 사장이 첫 퀴즈를 만들 때 노하우 수십 건에서 무엇부터 낼지 못 고른다. 그렇다고 **우리가**
// "필수 노하우 9종" 같은 고정 리스트를 정해 주면 안 된다 — 매장마다 필수가 다르고,
// 그 방향은 이미 한 번 기각됐다("우리가 정하면 안 된다, 시스템이 필요하다").
//
// 그래서 축을 둘로 나눈다.
//   · **스코프는 사장이** — 이미 있는 카테고리(= `playbook_entries.section`)를 복수로 고른다.
//     새 분류 체계를 발명하지 않는다(`lib/config/sections.ts` 가 정본).
//   · **압축은 코드가** — 고른 카테고리 **안에서** 아래 4기준으로 점수를 매겨 상위만 미리 고른다.
//
// ★정적 리스트가 아니라 기준 + 파이프라인이다. 노하우가 바뀌면 결과가 따라 바뀐다.
// ★사장이 결과를 뒤집을 수 있어야 하므로 **어느 기준에 걸렸는지**를 같이 돌려준다(`axes`·`reason`).
//
// ★ 순수 함수다. supabase·store·db 를 import 하지 않는다(detect.ts 와 같은 계약).

import type { PlaybookEntry } from '@/types';
import { UNSECTIONED } from '@/lib/config/sections';

// ══════════════════════════════════════════════════════════════════════════
// 1) 4기준과 가중치
// ══════════════════════════════════════════════════════════════════════════
export type EssentialAxis = 'safety' | 'irreversible' | 'service' | 'frequency';

/**
 * 가중치 근거 — "모르고 저질렀을 때 되돌리는 비용" 순이다.
 *
 * · safety 40       — ② 안전·법적 위험. 사람이 다치거나 매장이 문을 닫는다. 되돌릴 수단이 없고
 *                     대체 인력으로 메울 수도 없다 → 단독 최고 가중치.
 * · irreversible 30 — ③ 되돌릴 수 없는 손실(돈·재료·신뢰). 복구가 되긴 하지만 비싸다.
 * · service 20      — ① 손님 응대. 직원이 첫날 바로 부딪히는 축이지만, 실수 비용이 회복 가능하다.
 * · frequency 10    — ④ 빈도. **단독으로는 필수성이 아니다** — 자주 하지만 쉬운 일이 태반이다.
 *                     그래서 곱(배수)이 아니라 작은 가산으로만 둔다. 같은 무게의 두 노하우 중
 *                     더 자주 걸리는 쪽을 위로 올리는 정도의 역할이다.
 *
 * 합 = 100. 축을 더하거나 무게를 바꾸면 이 주석도 같이 고친다(근거 없는 숫자를 남기지 않는다).
 */
const WEIGHT: Record<EssentialAxis, number> = {
  safety: 40,
  irreversible: 30,
  service: 20,
  frequency: 10,
};

/** 무거운 순 — 사장에게 보여줄 이유를 고를 때와 정렬 표시에 쓴다. */
const AXIS_ORDER: EssentialAxis[] = ['safety', 'irreversible', 'service', 'frequency'];

/** 사장에게 보여줄 이름. 4기준 문구를 그대로 쓴다(화면마다 다르게 부르지 않는다). */
export const AXIS_LABEL: Record<EssentialAxis, string> = {
  safety: '안전·법적 위험',
  irreversible: '되돌릴 수 없는 손실',
  service: '손님 응대에 필요',
  frequency: '자주 일어나는 일',
};

/**
 * 신호 세기 — 같은 기준이라도 근거의 확실함이 다르다.
 * · STRUCTURED(1.0) = 사장이 구조로 넣은 값(카테고리·금지 칸·참조 횟수). 오탐이 거의 없다.
 * · TEXT(0.6)       = 본문 표현만 걸림. "칼"이 나온다고 위험한 노하우는 아니다 → 깎는다.
 *   0.6 인 이유: 본문만으로 걸린 안전(40×0.6=24)이 구조로 걸린 손님 응대(20×1.0=20)보다는 위고,
 *   구조로 걸린 되돌릴 수 없는 손실(30×1.0=30)보다는 아래여야 순서가 상식과 맞는다.
 */
const STRUCTURED = 1;
const TEXT = 0.6;

// ══════════════════════════════════════════════════════════════════════════
// 2) 본문 모으기 — detect.ts 와 같은 재료를 본다
// ══════════════════════════════════════════════════════════════════════════
function bodyOf(entry: PlaybookEntry): string {
  const sq = entry?.square;
  return [
    entry?.title,
    entry?.description,
    sq?.situation,
    ...(sq?.action?.steps ?? []),
    sq?.extract?.do,
    sq?.extract?.dont,
    entry?.execution?.timing,
    ...(entry?.tags ?? []),
  ]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/** 이 노하우가 속한 카테고리. 빈 값은 '기타'로 본다(sectionOf 규칙은 화면과 동일). */
export function sectionOf(entry: PlaybookEntry): string {
  return entry?.section?.trim() || UNSECTIONED;
}

// ══════════════════════════════════════════════════════════════════════════
// 3) 기준별 신호
// ══════════════════════════════════════════════════════════════════════════
// 표현 목록은 **판정 재료**일 뿐 문항 내용이 아니다 — 헛집어도 최악이 "미리 안 골라짐"이고,
// 목록은 그대로 다 보이므로 사장이 직접 고르면 된다(틀린 퀴즈가 나가는 경로가 아니다).

// ── ② 안전·법적 위험 ──────────────────────────────────────
// 다치거나(화재·화상·베임·감전), 먹고 탈 나거나(식중독·유통기한·알레르기), 법에 걸리는 것(미성년 주류).
// '칼'은 칼국수·칼로리에 걸리므로 쓰지 않고 '칼날'·'베이'만 본다(오탐 억제).
const SAFETY_RE = new RegExp([
  '화재|불이\\s?나|불\\s?끄|가스|누출|화상|데[일이]|감전|누전|칼날|베[이임]|찔리|미끄러|넘어지',
  '소화기|대피|119|구급|응급|다치|부상|위험|안전',
  '식중독|유통\\s?기한|소비\\s?기한|알레르기|알러지|교차\\s?오염|해동|변질|세균|곰팡이|소독|살균',
  '보건소|위생\\s?점검|식약처',
  '미성년|청소년|신분증|주류\\s?판매|과태료|영업\\s?정지',
].join('|'));

// ── ③ 되돌릴 수 없는 손실(돈·재료·신뢰) ─────────────────────
const IRREVERSIBLE_RE = new RegExp([
  '폐기|버려|버리면|버린다|못\\s?쓰|못쓰|재사용|타버|눌어|깨[지뜨]|파손|고장|망가|손상',
  '환불|보상|변상|배상|손해|손실|적자|시재|오차|정산\\s?오류|누락|미수',
  '취소\\s?불가|되돌릴|복구\\s?불가|단골|신뢰|컴플레인|클레임|악평|별점|리뷰',
].join('|'));

// ── ① 손님 응대 ────────────────────────────────────────────
const SERVICE_RE =
  /손님|고객|응대|접객|주문\s?받|주문을|계산|결제|포장|서빙|테이블\s?안내|문의|전화\s?응대|예약|대기|웨이팅|진상|컴플레인|클레임|교환|추천\s?메뉴|메뉴\s?설명/;

// ── ④ 빈도 ─────────────────────────────────────────────────
const FREQUENCY_RE =
  /매일|매번|늘\s|항상|상시|수시|매\s?근무|하루에|하루\s?[0-9한두세네]|오픈\s?때|마감\s?때|매주|주\s?[1-7]\s?회|반복|루틴/;

/**
 * 카테고리가 곧 근거가 되는 자리.
 * ★고정 "필수 카테고리 리스트"가 아니다 — 여기 없는 카테고리도 본문 신호로 얼마든지 걸린다.
 *   사장이 만든 카테고리도 마찬가지다. 이 표는 "표준 카테고리 이름 자체가 이미 그 기준을 뜻하는" 경우만
 *   적어 둔 것이고(`sections.ts` 의 표준 세트와 1:1), 없으면 그냥 본문으로 판정한다.
 */
const SECTION_AXIS: Record<string, EssentialAxis[]> = {
  '비상 상황': ['safety'],
  '위생·청소': ['safety', 'frequency'],
  '결제·정산': ['irreversible'],
  '고객 응대': ['service'],
  '오픈': ['frequency'],
  '마감': ['frequency'],
};

// ══════════════════════════════════════════════════════════════════════════
// 4) 판정
// ══════════════════════════════════════════════════════════════════════════
export type EssentialVerdict = {
  entryId: string;
  /** 0~100. 0 = 4기준 어디에도 안 걸렸다 = 미리 고르지 않는다. */
  score: number;
  /** 걸린 기준(무거운 순). 사장이 "왜 골라졌지"를 볼 수 있어야 한다. */
  axes: EssentialAxis[];
  /** 사장에게 보여줄 한 줄. 명사형(제목 어휘) — 목록 한 행에 들어간다. */
  reason: string;
};

/** 노하우 한 건의 필수성. 같은 입력이면 언제나 같은 결과다(AI 안 씀 — detect.ts 와 같은 이유). */
export function scoreEssential(entry: PlaybookEntry): EssentialVerdict {
  const body = bodyOf(entry);
  const section = sectionOf(entry);
  const sectionAxes = SECTION_AXIS[section] ?? [];

  const strength: Record<EssentialAxis, number> = { safety: 0, irreversible: 0, service: 0, frequency: 0 };
  const raise = (axis: EssentialAxis, s: number) => {
    if (s > strength[axis]) strength[axis] = s;
  };

  // 카테고리 = 사장이 직접 붙인 분류라 가장 확실한 근거다.
  for (const axis of sectionAxes) raise(axis, STRUCTURED);

  // ③ 금지 칸이 채워져 있다는 건 **그 매장에서 이미 사고가 났다**는 뜻이다
  //    (detect.ts t3 주석 — 07-29 §03 "출제 1순위"). 되돌릴 수 없는 손실의 가장 강한 신호.
  if (String(entry?.square?.extract?.dont ?? '').trim()) raise('irreversible', STRUCTURED);

  // ④ 직원이 실제로 물어본 횟수(서버가 chat_queries 30일 창으로 재계산한 값).
  //    표현으로 짐작하는 빈도보다 이쪽이 실측이다.
  if ((entry?.stats?.query_hits_30d ?? 0) > 0) raise('frequency', STRUCTURED);

  // 본문 표현 — 위 구조 신호가 없을 때의 보조.
  if (SAFETY_RE.test(body)) raise('safety', TEXT);
  if (IRREVERSIBLE_RE.test(body)) raise('irreversible', TEXT);
  if (SERVICE_RE.test(body)) raise('service', TEXT);
  if (FREQUENCY_RE.test(body)) raise('frequency', TEXT);
  // 종류(루틴/돌발/원칙/꿀팁)는 AI 가 붙인 내부 비계라 사장이 붙인 값만큼 못 믿는다 → TEXT 세기.
  if (entry?.category === 'Routine') raise('frequency', TEXT);

  const axes = AXIS_ORDER.filter((a) => strength[a] > 0);
  const score = Math.round(axes.reduce((sum, a) => sum + WEIGHT[a] * strength[a], 0));
  // 이유는 무거운 두 개까지만 — 한 행(460px·13sp)에 들어가야 한다.
  const reason = axes.slice(0, 2).map((a) => AXIS_LABEL[a]).join(' · ');
  return { entryId: entry.id, score, axes, reason };
}

// ══════════════════════════════════════════════════════════════════════════
// 5) 스코프 안에서 압축
// ══════════════════════════════════════════════════════════════════════════
/**
 * 미리 체크할 최대 개수.
 *
 * 근거 — 상한을 만드는 것은 화면이 아니라 **검토**다.
 *  · 퀴즈 만들기 3단계에서 사장이 문항을 한 개씩 눈으로 본다(생략할 수 없는 지점). 460px 화면에서
 *    문항 카드 8개면 스크롤 두어 번이고, 그보다 많아지면 검토가 형식적으로 변한다.
 *  · 2단계 생성은 노하우 하나씩 순차라 시간이 개수에 비례한다 — 화면 안내가 "20~30초"다.
 *    8개가 그 안내가 참일 수 있는 상한이다.
 *  · ★이건 **미리 체크의 상한이지 문항 수 상한이 아니다.** 목록은 전부 그대로 보이고
 *    사장이 얼마든지 더 고를 수 있다.
 */
export const MAX_PRECHECK = 8;

export type EssentialPick = {
  /** 미리 체크할 노하우 — 점수 높은 순. */
  picks: EssentialVerdict[];
  /** 고른 카테고리 안에 있던 노하우 수. "몇 개 중 몇 개"를 말할 때 쓴다. */
  scoped: number;
};

/**
 * 고른 카테고리 안에서 필수 상위를 뽑는다.
 *
 * @param entries  후보(발행된 노하우). 화면이 이미 걸러 넣는다.
 * @param sections 사장이 고른 카테고리. **빈 배열 = 아직 안 골랐다 = 매장 전체가 스코프**
 *                 (0164 가 "파트 없는 매장은 전부 공통"으로 정한 것과 같은 폴백 —
 *                  설정을 안 한 매장에서 기능이 아무 일도 안 하면 죽은 기능이 된다).
 * @param limit    미리 체크 상한. 기본 MAX_PRECHECK.
 */
export function pickEssential(
  entries: PlaybookEntry[],
  sections: string[],
  limit: number = MAX_PRECHECK,
): EssentialPick {
  const scope = new Set(sections.map((s) => s.trim()).filter(Boolean));
  const inScope = scope.size === 0 ? entries : entries.filter((e) => scope.has(sectionOf(e)));

  const byId = new Map(inScope.map((e) => [e.id, e]));
  const hitsOf = (id: string) => byId.get(id)?.stats?.query_hits_30d ?? 0;

  const picks = inScope
    .map(scoreEssential)
    .filter((v) => v.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 동점이면 실제로 더 많이 물어본 것 → 그래도 같으면 id 로 못 박는다(같은 입력=같은 결과).
      const h = hitsOf(b.entryId) - hitsOf(a.entryId);
      return h !== 0 ? h : a.entryId.localeCompare(b.entryId);
    })
    .slice(0, limit);

  return { picks, scoped: inScope.length };
}
