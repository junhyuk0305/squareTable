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

/**
 * "짝 목록" 형태 둘(flip_match · link_match) 공용 정규화.
 * ★ 양쪽 칸의 글자가 전부 서로 달라야 한다 — 같은 글자가 두 장 있으면 어느 것이 짝인지 알 수 없고
 *   (뒤집기), 선을 어디에 그어도 맞는 문항이 된다(짝짓기). 고치지 말고 버린다.
 *   짝: src/lib/quiz/formats/flipMatch.ts checkPairs
 */
function normPairs(raw: any, maxPairs: number): Record<string, unknown> | null {
  const ask = normAsk(raw);
  if (!ask) return null;
  const src = Array.isArray(raw?.pairs) ? raw.pairs : [];
  if (src.length < 3 || src.length > maxPairs) return null;
  const pairs = src.map((p: any) => ({ left: text(p?.left), right: text(p?.right) }));
  if (pairs.some((p: any) => !p.left || !p.right)) return null;
  const flat = pairs.flatMap((p: any) => [p.left, p.right]);
  if (new Set(flat).size !== flat.length) return null;
  return { ask, pairs, explain: text(raw?.explain) };
}

function pairsSchema(maxPairs: number) {
  return {
    type: 'object',
    properties: {
      ask: STR,
      pairs: {
        type: 'array',
        maxItems: maxPairs,
        items: { type: 'object', properties: { left: STR, right: STR }, required: ['left', 'right'] },
      },
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'pairs'],
  };
}

// ── 형태 16종 ──────────────────────────────────────────────
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

  order_build: {
    hint:
      '노하우의 단계를 items 에 **순서를 섞어서** 담고, answer_seq 에는 올바른 순서대로 그 항목의 '
      + '위치(0부터)를 담아라. 예: items 가 ["바닥 청소","POS 정산"] 이고 POS 정산이 먼저면 answer_seq 는 [1,0] 이다. '
      + '단계는 3~6개, 노하우에 있는 것만 쓴다. '
      + '"마지막에 하는 것부터" 같이 거꾸로 묻고 싶으면 ask 를 그렇게 쓰고 answer_seq 자체를 역순으로 담아라. '
      + '순서가 중요하지 않은 나열이면 출제하지 마라.',
    schema: {
      type: 'object',
      properties: {
        ask: STR,
        items: strArray(6),
        answer_seq: { type: 'array', items: INT, maxItems: 6 },
        explain: STR,
        source_index: INT,
      },
      required: ['ask', 'items', 'answer_seq'],
    },
    normalize: (raw) => {
      const ask = normAsk(raw);
      if (!ask) return null;
      const items = Array.isArray(raw?.items) ? raw.items.map(text) : [];
      if (items.length < 3 || items.length > 6) return null;
      if (items.some((v: string) => !v)) return null;
      // 같은 이름이 둘이면 응시자가 어느 쪽을 먼저 눌러야 할지 알 수 없다 — 고치지 말고 버린다.
      if (new Set(items).size !== items.length) return null;
      const seq = Array.isArray(raw?.answer_seq) ? raw.answer_seq : [];
      if (seq.length !== items.length) return null;
      const seen = new Set<number>();
      for (const v of seq) {
        if (!Number.isInteger(v) || v < 0 || v >= items.length) return null;
        if (seen.has(v)) return null;
        seen.add(v);
      }
      return { ask, items, answer_seq: seq, explain: text(raw?.explain) };
    },
  },

  // t2 수치
  value_pick: choicePickSpec(
    '노하우에 적힌 수치 하나를 정답으로 두고, 헷갈릴 만한 값 3개를 오답으로 붙여라. '
    + 'unit 에는 그 단위(펌프·도·분·개 등)를 적는다. '
    + '노하우에 없는 수치를 새로 만들지 마라. 적힌 수치가 없으면 출제하지 마라.',
    { optionalExtras: ['unit'] },
  ),

  scale_pick: choicePickSpec(
    '값이 다른데 서로 헷갈리기 쉬운 항목 **둘**을 골라 choices 에 이름만 담고(예: ["레귤러","라지"]), '
    + 'answer_index 로 값이 더 큰 쪽을 가리켜라. ask 는 무엇을 비교하는지 한 줄로 쓴다'
    + '(예: "시럽이 더 많이 들어가는 쪽은?"). unit 에는 비교하는 단위를 적는다. '
    + '두 항목의 값이 같거나, 노하우에 값이 하나만 있으면 출제하지 마라.',
    { maxChoices: 2, optionalExtras: ['unit'] },
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

  // t4 대응 — 노하우가 직접 적는 짝(물건↔자리, 용어↔뜻)이 재료다.
  // ★ flip_match 는 짝 정보가 응시 화면까지 내려가는 **유일한 형태**다(매칭 게임이라 그렇다).
  //   이유와 대가는 src/lib/quiz/formats/flipMatch.ts 맨 위 주석에 있다.
  flip_match: {
    bundled: true,
    hint:
      '노하우에서 **서로 짝인 것 둘**을 뽑아 pairs 에 담아라(예: 물건 ↔ 두는 자리, 용어 ↔ 뜻, 상황 ↔ 대응). '
      + '짝은 3~6쌍이고, left·right 는 카드에 들어갈 짧은 말이다(10자 안쪽이 좋다). '
      + 'ask 에는 무엇끼리 맞추는 판인지 한 줄로 쓴다(예: "물건과 두는 자리를 맞춰 주세요"). '
      + '같은 말이 두 번 나오면 안 된다. 대응 관계가 노하우에 없으면 출제하지 마라.',
    schema: pairsSchema(6),
    normalize: (raw) => normPairs(raw, 6),
  },

  link_match: {
    bundled: true,
    hint:
      '왼쪽 항목과 오른쪽 항목을 선으로 잇는 문제다. pairs 에 **서로 짝인 것**을 담아라'
      + '(예: 물건 ↔ 두는 자리, 용어 ↔ 뜻, 상황 ↔ 대응). '
      + '짝은 3~5쌍이고, left·right 는 한 줄에 들어갈 짧은 말이다. '
      + 'ask 에는 무엇끼리 잇는지 한 줄로 쓴다(예: "물건과 두는 자리를 이어 주세요"). '
      + '같은 말이 두 번 나오면 안 되고, 오른쪽 항목 여러 개에 동시에 해당하는 왼쪽 항목을 만들지 마라. '
      + '대응 관계가 노하우에 없으면 출제하지 마라.',
    schema: pairsSchema(5),
    normalize: (raw) => normPairs(raw, 5),
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

  branch_path: {
    hint:
      'ask 에는 판단해야 할 **구체적인 상황**을 한 줄로 쓴다(예: "포장 주문으로 음료 3잔이 나왔어요"). '
      + 'steps 는 그 상황에서 실제로 거치는 예/아니요 갈래 2~4개다. '
      + '각 갈래의 yes·no 에는 다음에 갈 곳을 "s1"(steps[1] 로) 또는 "r0"(results[0] 에서 끝) 처럼 적는다. '
      + 'results 는 갈래 끝에서 직원이 실제로 하게 될 행동이다. '
      + 'answer_path 는 ask 의 상황에서 **올바르게 답했을 때 밟는 순서**를 예=0·아니요=1 로 담고, '
      + '반드시 결과 칸에 닿는 지점에서 끝나야 한다. '
      + '조건에 따라 대응이 갈리는 내용이 노하우에 없으면 출제하지 마라.',
    schema: {
      type: 'object',
      properties: {
        ask: STR,
        steps: {
          type: 'array',
          items: { type: 'object', properties: { ask: STR, yes: STR, no: STR }, required: ['ask', 'yes', 'no'] },
          maxItems: 4,
        },
        results: strArray(4),
        answer_path: { type: 'array', items: INT, maxItems: 4 },
        explain: STR,
        source_index: INT,
      },
      required: ['ask', 'steps', 'results', 'answer_path'],
    },
    normalize: (raw) => {
      const ask = normAsk(raw);
      if (!ask) return null;
      const results = Array.isArray(raw?.results) ? raw.results.map(text) : [];
      if (results.length < 2 || results.length > 4) return null;
      if (results.some((v: string) => !v)) return null;

      const src = Array.isArray(raw?.steps) ? raw.steps : [];
      if (src.length < 2 || src.length > 4) return null;
      const steps = src.map((v: any) => ({ ask: text(v?.ask), yes: text(v?.yes), no: text(v?.no) }));
      // 다음 칸 표기 — 짝: src/lib/quiz/formats/branchPath.ts parseBranchNext
      const next = (v: string) => {
        const m = /^([sr])(\d+)$/.exec(v);
        if (!m) return null;
        const i = Number(m[2]);
        const limit = m[1] === 's' ? steps.length : results.length;
        return i < limit ? { kind: m[1], i } : null;
      };
      if (steps.some((st: any) => !st.ask || !next(st.yes) || !next(st.no))) return null;

      // 정답 경로를 실제로 걸어 본다. 결과에 닿는 지점에서 정확히 끝나야 한다.
      const path = Array.isArray(raw?.answer_path) ? raw.answer_path : [];
      if (path.length === 0 || path.length > steps.length) return null;
      let at = 0;
      for (let k = 0; k < path.length; k++) {
        const pick = path[k];
        if (pick !== 0 && pick !== 1) return null;
        const n = next(pick === 0 ? steps[at].yes : steps[at].no);
        if (!n) return null;
        if (n.kind === 'r') {
          if (k !== path.length - 1) return null;   // 결과에 닿았는데 경로가 남았다 = 어긋난 문항
          return { ask, steps, results, answer_path: path, explain: text(raw?.explain) };
        }
        at = n.i;
      }
      return null;                                   // 결과까지 못 닿았다
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
