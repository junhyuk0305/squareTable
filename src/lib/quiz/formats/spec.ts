// 훈련 퀴즈 v2 — 형태 명세(FormatSpec) 타입 + 선택형 공용 팩토리
//
// 설계 근거: 산출물/퀴즈시스템_설계_2026-07-29.html §03 출제 형태 · §04 게임 설계 규칙
//
// ★ 형태 하나 = 파일 하나(mc4.ts · wrongSpot.ts …). 새 형태를 붙이는 일이
//   "파일 하나 추가 + formats/index.ts 에 한 줄"로 끝나야 한다.
//   (코스가 'first_day'|'regular' 문자열로 5곳에 복제돼 있던 실패를 반복하지 않기 위한 구조다.)
//
// ★ 순환 참조 회피: FormatSpec 을 index.ts 가 아니라 여기 둔다.
//   형태 파일이 index.ts 를 import 하면 index.ts → 형태 파일 → index.ts 로 돈다.
//   index.ts 는 이 타입을 그대로 재export 한다(계약서 §4 의 "index.ts 가 FormatSpec 을 export").

import type { QuizFormat, QuizKind, QuizResponse } from '../types';

export type FormatSpec = {
  key: QuizFormat;
  kind: QuizKind;
  /**
   * 사장에게 보이는 이름. 07-29 §03 "화면에 게임 이름을 띄우지 않는다" 원칙에 따라
   * 게임 이름이 아니라 동작 서술이다("틀린 자리 찾기", "순서 고르기").
   * 07-29 문서의 형태 이름을 글자 그대로 쓴다.
   */
  label: string;
  /** 한 판 예상 소요(초). 07-29 §03 표의 값 그대로. */
  seconds: number;
  /**
   * 응시용으로 제거할 payload 키.
   * ★ 서버 0107 quiz_items_for 의 제거 목록과 글자 그대로 같아야 한다.
   *   불일치하면 정답이 새거나(제거 누락) 응시 화면이 깨진다(과잉 제거).
   *   키 목록으로 못 지우는 것(cards[].is_mine, cards[].answer, pairs 분해)은
   *   각 형태 파일의 주석에 "특수 처리"로 적어 두었다 — 그것도 서버와 짝이다.
   */
  stripKeys: string[];
  /**
   * 묶음형 — 노하우 여러 건을 섞어야 한 판이 되는 형태(07-29 §02 "단품형과 묶음형").
   * 근거 노하우를 하나로 좁힐 수 없어 entry_ids 에 사용한 노하우 전부를 넣는다.
   * (계약서 §4 FormatSpec 에 없는 추가 필드 — 생성기가 형태 목록을 또 하드코딩하지
   *  않게 하려고 형태 파일 안에 둔다. 선택 필드라 기존 계약을 깨지 않는다.)
   */
  bundled?: boolean;
  /**
   * ★★ 이 grade() 는 응시 채점용이 아니다.
   *
   * 실제 채점은 서버 RPC grade_quiz 가 한다. 문항이 DB에 저장되는 순간 "정답이 DB에 있다"가
   * 되므로, 응시 화면에서 클라 채점을 쓰면 정답을 그대로 유출하는 것이다(0107 설계의 타협 불가 지점).
   * 응시 화면은 정답 키가 제거된 payload 만 받는다 → 여기서는 애초에 채점이 불가능하다.
   *
   * 여기 grade() 를 쓸 수 있는 곳은 **정답이 붙어 있는 payload 를 손에 쥔 쪽**뿐이다:
   *   (a) 사장이 만든 문항을 미리보기로 직접 풀어볼 때 — 사장은 이미 정답을 안다
   *   (b) 단위 테스트
   *
   * ★ "서버 채점이 실패하면 클라로 폴백" 은 성립하지 않는다. 응시 payload 에는 정답이 없으므로
   *   폴백을 붙이면 전부 오답이 된다. 채점 실패는 폴백이 아니라 재시도로 다룬다
   *   (src/components/work/UnderstandingCheckSheet.tsx).
   * 현재 호출부 0건 — (a) 미리보기가 붙기 전까지는 (b) 용도로만 산다.
   */
  grade(payload: any, res: QuizResponse): boolean;
  /**
   * 사장이 직접 만든 문항을 저장 전에 거른다. null = 통과, 문자열 = 사장에게 그대로 보일 오류.
   * 워딩: ~해요체 · 느낌표 금지 · 무슨 일 + 뭘 하면 되는지.
   */
  validate(payload: any): string | null;
  /** 엣지 responseSchema 의 "문항 1개" 조각. 배열 래핑은 엣지가 한다. */
  aiSchema: object;
  /** 이 형태로 출제할 때 모델에게 줄 한국어 지시. 그라운딩 규칙은 엣지 공통 프롬프트가 담당. */
  aiHint: string;
};

// ── 스키마 조각 ────────────────────────────────────────────
// ★ float(type:'number') 금지. flash-lite 가 0.0000… 을 뱉어 JSON 이 깨진 실증이 있다
//   (supabase/functions/ai/index.ts:152). 정수는 반드시 'integer'.
export const STR = { type: 'string' } as const;
export const INT = { type: 'integer' } as const;
export const strArray = (maxItems: number) => ({ type: 'array', items: { type: 'string' }, maxItems });

// ── 공용 검증 ──────────────────────────────────────────────
export function checkAsk(p: any): string | null {
  return String(p?.ask ?? '').trim() ? null : '질문을 적어 주세요.';
}

export function checkChoices(p: any, max: number): string | null {
  const c = p?.choices;
  if (!Array.isArray(c) || c.length < 2) return '선택지는 2개 이상이어야 해요.';
  if (c.length > max) return `선택지는 ${max}개까지 넣을 수 있어요.`;
  if (c.some((x: any) => !String(x ?? '').trim())) return '선택지 내용을 모두 채워 주세요.';
  if (new Set(c.map((x: any) => String(x).trim())).size !== c.length) return '선택지가 서로 달라야 해요.';
  return null;
}

export function checkIndex(v: any, len: number, msg: string): string | null {
  return Number.isInteger(v) && v >= 0 && v < len ? null : msg;
}

/** 문자열 배열 칸(sequence·labels 등) 공통 검사. */
export function checkTexts(arr: any, min: number, max: number, name: string): string | null {
  if (!Array.isArray(arr) || arr.length < min) return `${name}은 ${min}개 이상이어야 해요.`;
  if (arr.length > max) return `${name}은 ${max}개까지 넣을 수 있어요.`;
  if (arr.some((x: any) => !String(x ?? '').trim())) return `${name} 내용을 모두 채워 주세요.`;
  return null;
}

// ── 선택형 공용 팩토리 ─────────────────────────────────────
// 13개 중 8개가 "질문 + 선택지 N개 + 정답 하나"로 같은 모양이다(계약서 §4 stripKeys 표 1행).
// 형태마다 다른 건 label·seconds·추가 칸(unit·left·situation·chosung)·aiHint 뿐이라 여기서 묶는다.
export type ChoicePickOptions = {
  key: QuizFormat;
  kind: QuizKind;
  label: string;
  seconds: number;
  aiHint: string;
  /** 선택지 상한. 07-29 표의 "4개 중" = 4, 초성만 5(난이도 3단에서 선택지를 늘린다). */
  maxChoices?: number;
  /** 이 형태만 갖는 추가 payload 칸 — 스키마에 얹는다. */
  extraSchema?: Record<string, object>;
  /** 추가 칸 중 모델이 반드시 채워야 하는 것. */
  extraRequired?: string[];
  /** 추가 칸 검증. 선택지 검사보다 먼저 돈다. */
  validateExtra?: (payload: any) => string | null;
  bundled?: boolean;
};

export function choicePickSpec(o: ChoicePickOptions): FormatSpec {
  const max = o.maxChoices ?? 4;
  return {
    key: o.key,
    kind: o.kind,
    label: o.label,
    seconds: o.seconds,
    // 서버 0107 quiz_items_for 와 동일해야 함
    stripKeys: ['answer_index', 'explain'],
    ...(o.bundled ? { bundled: true } : {}),
    grade: (payload, res) => typeof res === 'number' && res === payload?.answer_index,
    validate: (payload) =>
      checkAsk(payload)
      ?? (o.validateExtra ? o.validateExtra(payload) : null)
      ?? checkChoices(payload, max)
      ?? checkIndex(payload?.answer_index, payload?.choices?.length ?? 0, '정답을 골라 주세요.'),
    aiSchema: {
      type: 'object',
      properties: {
        ask: STR,
        ...(o.extraSchema ?? {}),
        choices: strArray(max),
        answer_index: INT,
        explain: STR,
        source_index: INT,
      },
      required: ['ask', ...(o.extraRequired ?? []), 'choices', 'answer_index'],
    },
    aiHint: o.aiHint,
  };
}
