// supabase/functions/ai/quizFormats.ts  (Deno / Supabase Edge Function)
//
// 훈련 퀴즈 v2 — 형태별 **생성 스키마 전용** 복제본.
//
// ★ 클라 SSOT는 src/lib/quiz/formats/ 다. 엣지는 클라 코드를 import 할 수 없어서
//   responseSchema 조각과 출제 지시(hint)가 여기 복제돼 있다.
//     클라(src/lib/quiz/formats) = UI 라벨 · 채점 · 사장 입력 검증 · stripKeys
//     엣지(이 파일)              = 생성 스키마 · 출제 지시 · 생성물 정규화
//   형태를 추가·수정하면 양쪽을 같이 고친다. 여기 없는 format 은 생성이 안 될 뿐
//   (빈 배열 반환) 응시·채점은 그대로 돈다 — 한쪽만 밀려도 조용히 깨지지는 않는다.
//
// ★ 스키마에 float(type:'number')를 넣지 말 것.
//   flash-lite 가 0.0000… 을 뱉어 JSON 이 깨진 실증이 있다(index.ts:152). 정수는 'integer'.
//
// normalize(): 모델 출력을 payload 로 바꾸고, 자동 채점이 깨질 물건은 **null 로 버린다**.
//   억지로 고치지 않는다(잘못 고친 문항이 정답 행세를 하는 게 더 나쁘다).

const STR = { type: 'string' };
const INT = { type: 'integer' };
const strArray = (maxItems: number) => ({ type: 'array', items: { type: 'string' }, maxItems });

export type QuizFormatSpec = {
  /** 문항 1개의 responseSchema. 배열 래핑은 handleQuizItem 이 한다. */
  schema: Record<string, unknown>;
  /** 이 형태로 출제할 때 줄 한국어 지시. 그라운딩 규칙은 공통 프롬프트가 담당. */
  hint: string;
  /** 노하우 여러 건을 섞어야 한 판이 되는 형태 → entry_ids 에 쓴 노하우 전부를 넣는다. */
  bundled?: boolean;
  /** 모델 출력 1개 → 저장할 payload. 검증 실패는 null(조용히 폐기). */
  normalize(raw: any): Record<string, unknown> | null;
};

// ── 공용 ───────────────────────────────────────────────────
const text = (v: unknown) => String(v ?? '').trim();

function normAsk(raw: any): string | null {
  const ask = text(raw?.ask);
  return ask ? ask : null;
}

/** "질문 + 선택지 N개 + 정답 하나" 형태 8종 공용 정규화. */
function normChoicePick(raw: any, maxChoices: number, extras: string[] = []): Record<string, unknown> | null {
  const ask = normAsk(raw);
  if (!ask) return null;
  const choices = Array.isArray(raw?.choices) ? raw.choices.map(text) : [];
  // 빈 선택지를 걸러내면 answer_index 가 밀린다 → 고치지 말고 버린다.
  if (choices.length < 2 || choices.length > maxChoices) return null;
  if (choices.some((c: string) => !c)) return null;
  if (new Set(choices).size !== choices.length) return null;
  const ai = raw?.answer_index;
  if (!Number.isInteger(ai) || ai < 0 || ai >= choices.length) return null;

  const out: Record<string, unknown> = { ask, choices, answer_index: ai, explain: text(raw?.explain) };
  for (const k of extras) {
    const v = text(raw?.[k]);
    if (!v) return null;   // 필수 추가 칸이 비면 문항이 성립하지 않는다
    out[k] = v;
  }
  return out;
}

function choicePickSpec(
  hint: string,
  opts: { maxChoices?: number; extras?: string[]; optionalExtras?: string[] } = {},
): QuizFormatSpec {
  const max = opts.maxChoices ?? 4;
  const extras = opts.extras ?? [];
  const optionals = opts.optionalExtras ?? [];
  const extraProps: Record<string, unknown> = {};
  for (const k of [...extras, ...optionals]) extraProps[k] = STR;
  return {
    hint,
    schema: {
      type: 'object',
      properties: {
        ask: STR,
        ...extraProps,
        choices: strArray(max),
        answer_index: INT,
        explain: STR,
        source_index: INT,
      },
      required: ['ask', ...extras, 'choices', 'answer_index'],
    },
    normalize: (raw) => {
      const out = normChoicePick(raw, max, extras);
      if (!out) return null;
      for (const k of optionals) {
        const v = text(raw?.[k]);
        if (v) out[k] = v;
      }
      return out;
    },
  };
}

// ── 형태 13종 ──────────────────────────────────────────────
export const QUIZ_FORMATS: Record<string, QuizFormatSpec> = {
  // t0 안전망 — 기존 task:'quiz' 가 만들던 모양 그대로.
  mc4: choicePickSpec(
    '현장에서 실제로 마주칠 상황 한 줄(ask)과 대응 선택지 3~4개를 만들어라. '
    + '정답은 노하우에 근거가 분명한 것 하나만 두고, 오답은 그럴듯하되 노하우와 명백히 어긋나게 만들어라.',
  ),

  // t1 순서
  order_pick: choicePickSpec(
    '노하우의 단계(steps)만 써서 순서 조합 3~4개를 만들어라. 각 선택지는 단계를 " → " 로 이은 한 줄이다. '
    + '정답은 실제 순서 하나뿐이고, 오답은 두 단계의 자리를 맞바꾼 것으로 만들어라. '
    + '단계를 새로 지어내거나 빼지 마라. 순서가 중요하지 않은 나열이면 출제하지 마라.',
  ),

  wrong_spot: {
    hint:
      '노하우의 단계를 순서대로 늘어놓되 한 자리만 잘못된 위치로 옮겨라. '
      + 'sequence 는 그 잘못된 순서 그대로이고, wrong_index 는 잘못 놓인 항목의 위치(0부터)다. '
      + '단계는 3~6개, 노하우에 있는 것만 쓴다. 순서가 중요하지 않은 나열이면 출제하지 마라.',
    schema: {
      type: 'object',
      properties: { ask: STR, sequence: strArray(6), wrong_index: INT, explain: STR, source_index: INT },
      required: ['ask', 'sequence', 'wrong_index'],
    },
    normalize: (raw) => {
      const ask = normAsk(raw);
      if (!ask) return null;
      const sequence = Array.isArray(raw?.sequence) ? raw.sequence.map(text) : [];
      if (sequence.length < 3 || sequence.length > 6) return null;
      if (sequence.some((s: string) => !s)) return null;
      const wi = raw?.wrong_index;
      if (!Number.isInteger(wi) || wi < 0 || wi >= sequence.length) return null;
      return { ask, sequence, wrong_index: wi, explain: text(raw?.explain) };
    },
  },

  // t2 수치
  value_pick: choicePickSpec(
    '노하우에 적힌 수치 하나를 정답으로 두고, 헷갈릴 만한 값 3개를 오답으로 붙여라. '
    + 'unit 에는 그 단위(펌프·도·분·개 등)를 적는다. '
    + '노하우에 없는 수치를 새로 만들지 마라. 적힌 수치가 없으면 출제하지 마라.',
    { optionalExtras: ['unit'] },
  ),

  fill_count: {
    hint:
      '탭할 때마다 하나씩 채우는 문제다. target 은 노하우에 적힌 횟수·개수 그대로(1~12 정수), '
      + 'unit 은 그 단위(펌프·샷·번·장 등)다. ask 는 무엇을 얼마나 넣는지 한 줄로 쓴다. '
      + '노하우에 개수가 적혀 있지 않으면 출제하지 마라.',
    schema: {
      type: 'object',
      properties: { ask: STR, target: INT, unit: STR, explain: STR, source_index: INT },
      required: ['ask', 'target', 'unit'],
    },
    normalize: (raw) => {
      const ask = normAsk(raw);
      const unit = text(raw?.unit);
      const t = raw?.target;
      if (!ask || !unit) return null;
      if (!Number.isInteger(t) || t < 1 || t > 12) return null;
      return { ask, target: t, unit, explain: text(raw?.explain) };
    },
  },

  // t3 금지
  trap_pick: choicePickSpec(
    '행동 4개 중 하면 안 되는 것 하나를 고르는 문제다. 정답은 노하우의 금지(dont) 그대로 쓰고, '
    + '오답 3개는 같은 노하우의 단계에서 뽑은 정상 행동으로 채워라. '
    + '금지가 적혀 있지 않으면 출제하지 마라.',
  ),

  mine_tap: {
    bundled: true,
    hint:
      '카드가 하나씩 지나가고 하면 안 되는 행동일 때만 탭하는 문제다. '
      + 'is_mine=true 카드는 노하우의 금지를 한 줄 행동으로 쓴 것, false 카드는 같은 노하우의 정상 행동이다. '
      + '카드는 4~8장이고 금지와 정상이 각각 1장 이상 있어야 한다. '
      + '상식적으로는 합리적으로 보이는 문장이어야 골라내는 연습이 된다.',
    schema: {
      type: 'object',
      properties: {
        ask: STR,
        cards: {
          type: 'array',
          items: { type: 'object', properties: { text: STR, is_mine: { type: 'boolean' } }, required: ['text', 'is_mine'] },
          maxItems: 8,
        },
        explain: STR,
        source_index: INT,
      },
      required: ['ask', 'cards'],
    },
    normalize: (raw) => {
      const ask = normAsk(raw);
      if (!ask) return null;
      const src = Array.isArray(raw?.cards) ? raw.cards : [];
      if (src.length < 4 || src.length > 8) return null;
      const cards = src.map((c: any) => ({ text: text(c?.text), is_mine: c?.is_mine === true }));
      if (cards.some((c: any) => !c.text)) return null;
      const mines = cards.filter((c: any) => c.is_mine).length;
      if (mines === 0 || mines === cards.length) return null;
      return { ask, cards, explain: text(raw?.explain) };
    },
  },

  // t4 짝
  pair_pick: choicePickSpec(
    '왼쪽 항목 하나(left)를 주고 오른쪽 3~4개 중 맞는 짝을 고르는 문제다. '
    + '짝은 상황↔말(scripts)·물건↔자리처럼 노하우에 실제로 붙어 있는 대응만 쓴다. '
    + '오답 해설은 "틀렸어요"가 아니라 "이 매장은 이렇게 해요" 방향으로 쓴다.',
    { extras: ['left'] },
  ),

  match_line: {
    bundled: true,
    hint:
      '좌우를 잇는 문제다. 노하우에 실제로 붙어 있는 대응(상황↔말·물건↔자리·메뉴↔재료)만 3~5쌍 뽑아라. '
      + '오른쪽 값이 서로 겹치면 안 된다. 짝이 3쌍도 안 나오면 출제하지 마라.',
    schema: {
      type: 'object',
      properties: {
        ask: STR,
        pairs: {
          type: 'array',
          items: { type: 'object', properties: { left: STR, right: STR }, required: ['left', 'right'] },
          maxItems: 5,
        },
        explain: STR,
        source_index: INT,
      },
      required: ['ask', 'pairs'],
    },
    normalize: (raw) => {
      const ask = normAsk(raw);
      if (!ask) return null;
      const src = Array.isArray(raw?.pairs) ? raw.pairs : [];
      if (src.length < 3 || src.length > 5) return null;
      const pairs = src.map((p: any) => ({ left: text(p?.left), right: text(p?.right) }));
      if (pairs.some((p: any) => !p.left || !p.right)) return null;
      // 오른쪽이 겹치면 어느 줄로 이어도 맞는 게 되어 채점이 모호해진다.
      if (new Set(pairs.map((p: any) => p.right)).size !== pairs.length) return null;
      return { ask, pairs, explain: text(raw?.explain) };
    },
  },

  // t5 갈래
  case_pick: choicePickSpec(
    '조건이 붙은 상황 한 줄(situation)을 주고 대응 3~4개 중 맞는 것을 고르는 문제다. '
    + '상황과 대응 모두 노하우에 적힌 조건·결과 그대로 쓴다. '
    + '오답은 다른 조건일 때의 대응으로 만들어야 갈래를 가르는 연습이 된다.',
    { extras: ['situation'] },
  ),

  quick_judge: {
    bundled: true,
    hint:
      '카드 하나마다 두 버튼 중 하나를 고르는 문제다. labels 는 두 버튼 이름(예: ["쓴다","버린다"])이고, '
      + 'cards[].answer 는 그 카드의 정답 버튼 위치(0 또는 1)다. 카드는 4~8장, '
      + 'seconds 는 카드 1장당 주는 시간(2~5 정수, 기본 3)이다. '
      + '두 버튼의 답이 각각 1장 이상 나와야 하고, 카드 내용은 노하우의 조건·사례에서만 뽑는다.',
    schema: {
      type: 'object',
      properties: {
        ask: STR,
        labels: strArray(2),
        cards: {
          type: 'array',
          items: { type: 'object', properties: { text: STR, answer: INT }, required: ['text', 'answer'] },
          maxItems: 8,
        },
        seconds: INT,
        explain: STR,
        source_index: INT,
      },
      required: ['ask', 'labels', 'cards', 'seconds'],
    },
    normalize: (raw) => {
      const ask = normAsk(raw);
      if (!ask) return null;
      const labels = Array.isArray(raw?.labels) ? raw.labels.map(text) : [];
      if (labels.length !== 2 || labels.some((l: string) => !l)) return null;
      const src = Array.isArray(raw?.cards) ? raw.cards : [];
      if (src.length < 4 || src.length > 8) return null;
      const cards = src.map((c: any) => ({ text: text(c?.text), answer: c?.answer }));
      if (cards.some((c: any) => !c.text || (c.answer !== 0 && c.answer !== 1))) return null;
      if (new Set(cards.map((c: any) => c.answer)).size < 2) return null;
      const s = raw?.seconds;
      const seconds = Number.isInteger(s) && s >= 2 && s <= 5 ? s : 3;
      return { ask, labels, cards, seconds, explain: text(raw?.explain) };
    },
  },

  // t6 이름
  name_pick: choicePickSpec(
    '매장에서만 쓰는 말이 무엇을 가리키는지 묻는 문제다. ask 에 그 말이 뜻하는 것을 한 줄로 설명하고, '
    + '선택지에는 매장 용어 3~4개를 둔다. 정답은 노하우에 실제로 나오는 용어여야 하고, '
    + '일반 명사(청소·마감처럼 아무 매장에서나 쓰는 말)는 출제하지 마라.',
  ),

  chosung: choicePickSpec(
    '매장 용어의 초성만 보여주고 맞히는 문제다. chosung 에는 정답 용어의 초성을 띄어서 적고'
    + '(예: 백플러시 → "ㅂ ㅍ ㄹ ㅅ"), ask 에는 그 용어가 무엇인지 한 줄 설명을 쓴다. '
    + '선택지는 3~5개이고 정답은 노하우에 실제로 나오는 용어여야 한다. 일반 명사는 출제하지 마라.',
    { maxChoices: 5, extras: ['chosung'] },
  ),
};
