// 훈련 퀴즈 v2 — 델타 출제 판정 (SSOT)
//
// 설계 근거: 산출물/퀴즈시스템_설계_2026-07-29.html §06 "네 가지 계기 — 변경"
//   원설계 한 줄: **노하우가 바뀌면 바뀐 칸만 1문항으로 낸다.**
//   0169 가 "바뀌면 다시 확인이 나간다"까지 붙였고, 남은 것이 "그때 무슨 문항을 내는가"다.
//
// ══════════════════════════════════════════════════════════════════════════
// ① 왜 이 모양인가 — 옛 값이 어디에도 안 남는다
// ══════════════════════════════════════════════════════════════════════════
// "바뀐 칸"을 곧이곧대로 알려면 **고치기 전의 노하우**가 있어야 한다. 그런데 없다:
//   · playbook_entries 는 제자리 UPDATE 다(db.ts updateEntry). square·execution jsonb 가 덮인다.
//   · version 컬럼은 0001 부터 default 1 이고 **올리는 코드가 한 줄도 없다**(죽은 칸이다).
//   · 이력·스냅샷 테이블 없음.
// 옛 값이 남는 곳은 딱 하나 — **그 노하우로 만들어 둔 문항(quiz_items.payload)** 이다.
// 문항은 만들 때 본 노하우의 사본이고, 0114 가 그때의 시각(source_updated_at)까지 남겨 뒀다.
//
// 그래서 판정을 뒤집는다:
//   ✗ "노하우의 어떤 칸이 바뀌었나"(옛 값 필요)
//   ✓ "지금의 노하우가 이 문항을 **아직 뒷받침하나**"(있는 재료로 된다)
// 뒷받침하면 그 칸은 그대로다 → 다시 묻지 않는다. 못 하면 그 칸이 바뀐 것 → 그 칸만 낸다.
//
// ══════════════════════════════════════════════════════════════════════════
// ② 칸(cell) = 지식 유형(kind)
// ══════════════════════════════════════════════════════════════════════════
// 노하우를 쪼개는 축은 이미 있다 — detect.ts 가 보는 유형이 곧 칸이다.
//   t1 순서=action.steps · t2 값=수치 · t3 금지=extract.dont · t4 짝=이름↔값 ·
//   t5 갈래=situation · t6 이름=매장 용어 · t0 안전망=본문 전체
// 문항 하나는 정확히 한 칸에 속한다(FORMATS[format].kind). 그래서 "바뀐 칸만 1문항"이
// "달라진 문항들의 kind 를 모아 유형당 하나씩"으로 그대로 옮겨진다.
//
// ══════════════════════════════════════════════════════════════════════════
// ③ 판정은 두 자뿐이다 (AI 없음 · Math.random 없음 · 같은 재료면 같은 결과)
// ══════════════════════════════════════════════════════════════════════════
//   ⓐ 수치는 **정확히** 본다 — 문항의 정답에 든 (값,단위)가 지금 노하우의 수치 목록에 없으면 바뀐 것.
//      2펌프 → 3펌프 는 글자로는 거의 같아서 ⓑ 로는 절대 안 잡힌다. 그래서 따로 둔다.
//   ⓑ 글자는 **닮았나**로 본다 — 정답 문장의 2글자 조각(bigram) 중 지금 그 칸에 남아 있는 비율.
//      토큰 단위 비교는 한국어 어미 변화("붓지 마세요" ↔ "붓는다")에서 곧바로 무너진다.
//
// ⛔ 확인할 수 없으면 **바뀐 것으로 본다**(모르는 형태·근거 노하우 소멸·정답 텍스트 없음).
//    반대 방향으로 기울이면 옛 정답이 조용히 계속 나간다 — 0114 가 막으려던 바로 그것이다.
//
// ★ 이 파일은 순수 함수다. supabase·store·화면을 import 하지 않는다.

import type { PlaybookEntry } from '@/types';
import { numericValues, storeTerms, type NumericValue } from './detect';
import { FORMATS } from './formats';
import type { QuizFormat, QuizItem, QuizKind } from './types';

/**
 * 정답 문장이 그 칸에 "아직 남아 있다"고 볼 최소 닮음(0~1).
 *
 * 0.6 = 조사·어미가 바뀌고 한두 낱말이 갈려도 같은 문장으로 보되, 문장을 새로 쓰면 떨어지는 선.
 * 낮추면 고친 것을 못 잡고(옛 정답이 나간다), 올리면 안 고친 것까지 다시 묻는다(기능이 무의미해진다).
 */
export const SUPPORT_MIN = 0.6;

// ── 글자 닮음 ──────────────────────────────────────────────
/** 공백·문장부호를 지운다. 비교는 글자만 본다 — 띄어쓰기 교정이 "바뀜"이 되면 안 된다. */
function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s.,!?~·…"'`^*()[\]{}<>/\\|:;+=_-]/g, '');
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2));
  return out;
}

/**
 * a 의 2글자 조각 중 b 안에 남아 있는 비율. 방향이 있다 —
 * "정답이 칸 안에 있나"를 묻는 것이지 칸 전체가 정답과 같은지를 묻는 게 아니다.
 * (칸에 다른 내용이 더 붙는 건 정상이고, 정답이 사라지는 것만 문제다.)
 */
function containment(a: string, b: string): number {
  const A = norm(a);
  const B = norm(b);
  if (!A) return 1;
  if (A.length < 2) return B.includes(A) ? 1 : 0;
  const pool = new Set(bigrams(B));
  const grams = bigrams(A);
  let hit = 0;
  for (const g of grams) if (pool.has(g)) hit += 1;
  return hit / grams.length;
}

// ── 문항 → 정답 쪽 텍스트 ──────────────────────────────────
// ★ **오답(오답 보기·미끼 카드)은 재료가 아니다.** 오답은 일부러 노하우에 없게 만든 것이라
//   같이 비교하면 안 바뀐 문항도 전부 "바뀜"이 된다. 정답 쪽만 꺼낸다.
//
// ★★ 형태를 하나 추가하면 **여기도 같이 늘려야 한다**(형태 추가 시 손대는 자리가 하나 늘었다).
//    빠뜨려도 조용히 넘어가지 않는다 — 아래 표가 `Record<QuizFormat, …>` 라 tsc 가 먼저 막는다.
//    (그 방어가 없으면 그 형태만 "확인 불가 → 늘 바뀜"이 되어 델타가 조용히 무의미해진다.)

const choiceAnswer = (p: any): string[] => {
  const c = p?.choices;
  const i = p?.answer_index;
  return Array.isArray(c) && Number.isInteger(i) && c[i] != null ? [String(c[i])] : [];
};
/** 값 형태 — 선택지는 숫자만 있고 단위가 옆 칸에 있다. 붙여야 수치 추출기가 읽는다. */
const valueAnswer = (p: any): string[] => choiceAnswer(p).map((v) => `${v} ${p?.unit ?? ''}`);
const pairsAnswer = (p: any): string[] =>
  (Array.isArray(p?.pairs) ? p.pairs : []).flatMap((x: any) => [String(x?.left ?? ''), String(x?.right ?? '')]);

const ANSWER_TEXTS: Record<QuizFormat, (payload: any) => string[]> = {
  mc4: choiceAnswer,
  order_pick: choiceAnswer,
  // 틀린 자리 찾기 — sequence 는 노하우의 단계인데 **한 칸만 일부러 망가뜨린 것**이다.
  // 망가뜨린 칸(wrong_index)을 빼야 나머지가 노하우 그대로다.
  wrong_spot: (p) => (Array.isArray(p?.sequence) ? p.sequence : []).filter((_: any, i: number) => i !== p?.wrong_index),
  order_build: (p) => (Array.isArray(p?.items) ? p.items : []).map((x: any) => String(x ?? '')),
  value_pick: valueAnswer,
  fill_count: (p) => [`${p?.target ?? ''} ${p?.unit ?? ''}`],
  scale_pick: valueAnswer,
  numeric_entry: (p) => [`${p?.answer_value ?? ''} ${p?.unit ?? ''}`],
  trap_pick: choiceAnswer,
  // 지뢰 = 하지 말 것. 지뢰가 아닌 카드는 미끼라 재료가 아니다.
  mine_tap: (p) => (Array.isArray(p?.cards) ? p.cards : []).filter((c: any) => c?.is_mine).map((c: any) => String(c?.text ?? '')),
  mark_paragraph: (p) =>
    (Array.isArray(p?.parts) ? p.parts : []).filter((c: any) => c?.is_wrong).map((c: any) => String(c?.text ?? '')),
  flip_match: pairsAnswer,
  link_match: pairsAnswer,
  case_pick: choiceAnswer,
  // 빠른 판별 — 카드가 전부 노하우에서 나온 상황이다(정답은 어느 쪽으로 미느냐일 뿐).
  quick_judge: (p) => (Array.isArray(p?.cards) ? p.cards : []).map((c: any) => String(c?.text ?? '')),
  branch_path: (p) => [
    ...(Array.isArray(p?.steps) ? p.steps : []).map((s: any) => String(s?.ask ?? '')),
    ...(Array.isArray(p?.results) ? p.results : []).map((x: any) => String(x ?? '')),
  ],
  name_pick: choiceAnswer,
  chosung: choiceAnswer,
};

/** 이 문항이 "노하우에서 가져온 것"이라고 주장하는 텍스트들. 빈 배열 = 확인 불가. */
export function answerTexts(item: Pick<QuizItem, 'format' | 'payload'>): string[] {
  const pick = ANSWER_TEXTS[item.format];
  if (!pick) return [];
  return pick(item.payload ?? {})
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);
}

// ── 노하우 → 칸 본문 ───────────────────────────────────────
const txt = (v: unknown) => String(v ?? '').trim();
const lines = (...v: unknown[]) => v.map(txt).filter(Boolean).join('\n');

/**
 * 이 유형(칸)이 사는 자리. detect.ts 가 그 유형을 판정할 때 보는 곳과 같아야 한다 —
 * 다르면 "안 본 칸이 바뀌었는데 바뀐 줄 모른다"가 된다.
 */
function cellText(entries: PlaybookEntry[], kind: QuizKind): string {
  return entries
    .map((e) => {
      const sq = e?.square;
      const steps = (sq?.action?.steps ?? []).map(txt).filter(Boolean).join('\n');
      // 등록 화면에서 구조로 받은 값(standard)은 본문에 문장으로 안 적힌다 —
      // 값과 단위를 **붙여서** 실어야 "2샷" 같은 정답 조각이 칸 안에서 발견된다.
      const std = sq?.standard ? `${txt(sq.standard.label)} ${txt(sq.standard.value)}${txt(sq.standard.unit)}` : '';
      switch (kind) {
        case 't1': return steps;
        case 't2': return lines(e.title, sq?.situation, steps, std);
        case 't3': return txt(sq?.extract?.dont);
        case 't4': return lines(e.title, std);
        case 't5': return txt(sq?.situation);
        case 't6': return lines(e.title, sq?.situation, steps, sq?.extract?.do, sq?.extract?.dont, storeTerms(e).join('\n'));
        default:   return lines(e.title, e.description, sq?.situation, steps, sq?.extract?.do, sq?.extract?.dont);
      }
    })
    .filter(Boolean)
    .join('\n');
}

function sameNumber(a: NumericValue, b: NumericValue): boolean {
  return a.unit === b.unit && a.value === b.value;
}

// ── 판정 ───────────────────────────────────────────────────
/**
 * 0114 의 낡음 판정 — 만들 때 본 시각이 지금 노하우보다 뒤처져 있나.
 * **델타의 1차 관문이다.** 여기서 안 걸리면 노하우를 건드린 적조차 없는 것이라 더 볼 것이 없다.
 * null = 스냅샷 이전 행 → 모르는 것을 "바뀌었다"고 말하지 않는다(0114 주석 그대로).
 */
export function isStampStale(item: QuizItem, entryById: Map<string, PlaybookEntry>): boolean {
  if (!item.source_updated_at) return false;
  const newest = (item.entry_ids ?? [])
    .map((id) => entryById.get(id)?.updated_at)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  if (!newest) return false;
  return Date.parse(item.source_updated_at) < Date.parse(newest);
}

/**
 * 지금의 노하우가 이 문항을 아직 뒷받침하나. false = 그 칸이 실제로 바뀌었다.
 * ⛔ 확인할 수 없으면 false 다(위 ③ 마지막 줄).
 */
export function isSupported(item: QuizItem, entryById: Map<string, PlaybookEntry>): boolean {
  const es = (item.entry_ids ?? []).map((id) => entryById.get(id)).filter((e): e is PlaybookEntry => !!e);
  if (es.length === 0) return false;                       // 근거 노하우가 사라졌다
  const kind = FORMATS[item.format]?.kind;
  if (!kind) return false;                                 // 모르는 형태
  const texts = answerTexts(item);
  if (texts.length === 0) return false;                    // 정답 쪽을 못 꺼냈다

  // ⓐ 수치 — 정확 비교. 단위는 detect 가 이미 정규화해 준다(℃→도, %→퍼센트 …).
  const cellNums = es.flatMap((e) => numericValues(e));
  const asked = numericValues({ title: texts.join('\n') });
  for (const n of asked) if (!cellNums.some((c) => sameNumber(c, n))) return false;

  // ⓑ 글자 — 정답 문장 하나라도 그 칸에서 사라졌으면 바뀐 것이다.
  const cell = cellText(es, kind);
  if (!cell) return false;                                 // 칸 자체가 비었다(하지 말 것을 지웠다 등)
  return texts.every((t) => containment(t, cell) >= SUPPORT_MIN);
}

export type QuizDelta = {
  /** 근거가 실제로 달라진 문항. 이것만 다시 낸다. */
  changed: QuizItem[];
  /** 시각은 낡았지만 내용은 그대로인 문항. **다시 묻지 않는다** — 델타가 아끼는 몫이 여기다. */
  intact: QuizItem[];
};

/**
 * 노하우가 바뀐 뒤, 기존 문항 중 무엇이 실제로 달라졌나.
 *
 * `changed` 가 비어 있으면 **아무것도 내지 않는다**. 섹션 이름 바꾸기 한 번에 그 섹션 노하우
 * 전부의 updated_at 이 밀리는데(db.ts renameSection · 0169 ③) 그때 문항이 통째로 다시 나가면
 * 직원에게는 이유 없는 재확인이다.
 */
export function quizDelta(entries: PlaybookEntry[], items: QuizItem[]): QuizDelta {
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const out: QuizDelta = { changed: [], intact: [] };
  for (const q of items) {
    if (q.status !== 'active') continue;
    if (!isStampStale(q, entryById)) continue;             // 손댄 적 없는 문항은 후보가 아니다
    (isSupported(q, entryById) ? out.intact : out.changed).push(q);
  }
  return out;
}

/**
 * 다시 낼 **칸** 목록. 같은 칸의 문항이 여럿 달라져도 칸은 하나다 —
 * 원설계의 "바뀐 칸만 **1문항**"이 여기서 지켜진다.
 * 순서는 t0…t6 고정이다(정렬 기준이 재료뿐이라 같은 입력이면 늘 같은 결과다).
 */
export function changedKinds(entries: PlaybookEntry[], items: QuizItem[]): QuizKind[] {
  const seen = new Set<QuizKind>();
  for (const q of quizDelta(entries, items).changed) {
    const k = FORMATS[q.format]?.kind;
    if (k) seen.add(k);
  }
  return [...seen].sort();
}
