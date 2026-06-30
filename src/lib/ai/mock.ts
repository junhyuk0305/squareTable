// lib/ai/mock.ts
// 키 없을 때 도는 로컬 대역. 핵심: "제공된 SOP 내용만 재조합" = 구조적으로 환각 0.
// 실제 Gemini 호출도 같은 계약(그라운딩+양식+분량)을 따르도록 설계됨.

import type {
  GenerateAnswerInput,
  GenerateAnswerOutput,
  StructureSquareInput,
  StructureSquareOutput,
  StructuredSegment,
  PatchSquareInput,
  IntentInput,
  IntentOutput,
  AiFollowup,
} from './types';
import type { Category } from '@/types';
import { MAX_ACTIONS, MAX_DONTS } from './config';

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

// 여러 SOP의 steps/donts를 합쳐 양식·분량 안에서 답을 구성(추출형 → 무환각).
export function mockGenerateAnswer(input: GenerateAnswerInput): GenerateAnswerOutput {
  const sops = input.sops.filter(Boolean);
  if (sops.length === 0) {
    return { block: null, grounded: true, usedSopIds: [] };
  }

  // 상위 2건까지만 합성 (멀티 SOP 결합 시연)
  const used = sops.slice(0, 2);
  const actions = dedupe(used.flatMap((s) => s.steps)).slice(0, MAX_ACTIONS);
  const donts = dedupe(used.flatMap((s) => s.donts)).slice(0, MAX_DONTS);
  const primary = used[0];

  return {
    block: {
      summary: primary.situation || primary.title,
      actions,
      donts,
      source: {
        entry_id: primary.id,
        creator_name: primary.creatorName,
        title: primary.title,
        version: primary.version,
        updated_at: primary.updatedAt,
      },
    },
    grounded: true,
    usedSopIds: used.map((s) => s.id),
  };
}

// 텍스트 1조각 → SQUARE 1개(휴리스틱). 다중 분리 시 조각마다 호출.
function structureOne(raw: string, category?: Category): StructuredSegment {
  const sentences = raw
    .split(/[.!?\n。]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  const steps = sentences.length ? sentences.slice(0, MAX_ACTIONS) : [raw.trim()];
  const title = (sentences[0] ?? raw).slice(0, 30);
  const first = sentences[0] ?? raw.trim();
  const joined = sentences.length ? sentences.join(' ') : raw.trim();

  // ⚠️ 날조 금지: 원문에서 뽑히는 것만 채우고 나머지는 빈 칸.
  let situation = first;
  let uncover = '';
  let dont = '';

  if (category === 'Event') {
    const negCues = ['안', '하지마', '하지 마', '금지', '절대', '말 것', '말것'];
    if (negCues.some((c) => raw.includes(c))) dont = first;
  } else if (category === 'Know-how') {
    const judgeCues = ['보면', '판단', '기준', '될 때', '됐', '익으면', '느낌', '정도'];
    const judged = sentences.find((s) => judgeCues.some((c) => s.includes(c)));
    if (judged) uncover = judged;
  } else if (category === 'Context') {
    situation = joined;
  }

  // 양(개수) 우선 감지 → count, 아니면 정도 → spectrum. (mock은 일반 라벨, 실 LLM이 품목별로 생성)
  const countCue = raw.match(/펌프|샷|스쿱|바퀴|장|번/);
  const degreeCues = ['정도', '깨끗', '노릇', '적당', '익', '굽', '농도', '진하', '연하', '바삭', '알맞'];
  const hasDegree = category === 'Know-how' || degreeCues.some((c) => raw.includes(c));
  const scalePrompt = countCue
    ? { kind: 'count' as const, label: '양', ask: `몇 ${countCue[0]}가 기준이에요?`, unit: countCue[0] }
    : hasDegree
      ? { kind: 'spectrum' as const, label: '완성 기준', ask: '어느 정도가 기준이에요?', ends: ['약함', '강함'] as [string, string] }
      : undefined;

  // 단답 보강용 꼬리질문(휴리스틱) — 입력이 매우 짧고 단계가 빈약하면 한 개만.
  // (실 LLM은 그 노하우에 맞춰 더 정교하게 생성. mock은 데모 안전망.)
  const followups: AiFollowup[] = [];
  if (raw.trim().length < 12 && steps.length <= 1) {
    followups.push({ cell: 'steps', ask: '조금 더 구체적으로 알려주실 수 있어요? 어떤 상황에서 무엇을 하는 건가요?' });
  }

  return {
    category: (category ?? 'Routine') as Category,
    title,
    keywords: dedupe(raw.split(/\s+/).filter((t) => t.length >= 2)).slice(0, 8),
    square: {
      situation,
      quagmire: '',
      uncover,
      action: { steps, scripts: [] },
      result: { before: '', after: '', metric: '' },
      extract: { do: '', dont },
    },
    ...(scalePrompt ? { scalePrompt } : {}),
    ...(followups.length > 0 ? { followups } : {}),
  };
}

// 강한 구분 신호(줄바꿈 / "그리고" 등)일 때만 2~3조각으로 나눈다(명백할 때만 — 거짓 분리 방지).
function splitChunks(raw: string): string[] {
  const byLine = raw.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 2);
  if (byLine.length >= 2) return byLine.slice(0, 3);
  const byConj = raw.split(/\s*(?:그리고나서|그리고|그담에|그 다음|또한|또,|또 )\s*/).map((s) => s.trim()).filter((s) => s.length > 5);
  if (byConj.length >= 2) return byConj.slice(0, 3);
  return [raw.trim()];
}

// 원문 → SQUARE. 다중 노하우면 segments[]로 나눠 반환(top-level = segments[0], 단일 흐름 호환).
// input.categoryGuide는 실 LLM 프롬프트 주입용 — mock에서는 의도적으로 미사용.
export function mockStructureSquare(input: StructureSquareInput): StructureSquareOutput {
  // 명백한 잡음(자모·반복·기호·초단문)은 mock에서도 usable=false (클라 잡음필터와 일관).
  const t = (input.rawText ?? '').trim();
  const meaningful = (t.match(/[가-힣a-zA-Z]/g) || []).length;
  if (meaningful < 2 || (new Set(t.replace(/\s+/g, '')).size <= 2 && t.length >= 3)) {
    return { usable: false, title: '', keywords: [], square: structureOne('', input.category).square, segments: [] };
  }
  const chunks = splitChunks(input.rawText);
  const segments = chunks.map((c) => {
    const seg = structureOne(c, input.category);
    // 재정리 패스(skipFollowups)에서는 꼬리질문을 떼어 무한 되묻기를 막는다.
    if (input.skipFollowups && seg.followups) delete seg.followups;
    return seg;
  });
  const head = segments[0];
  return {
    usable: true,
    square: head.square,
    title: head.title,
    keywords: head.keywords,
    ...(head.scalePrompt ? { scalePrompt: head.scalePrompt } : {}),
    ...(head.followups ? { followups: head.followups } : {}),
    segments,
  };
}

// 대화형 수정(mock) — 자연어 수정요청을 휴리스틱으로 현재 SQUARE에 반영.
// 실 LLM은 부분 패치를 정교히. mock은 "추가/삭제"만 어림 처리(데모 안전망).
export function mockPatchSquare(input: PatchSquareInput): StructureSquareOutput {
  const { current, instruction } = input;
  const ins = instruction.trim();
  const isRemove = /빼|삭제|제거|없애|지워/.test(ins);
  const mentionsDont = /금지|하지\s*말|하면\s*안/.test(ins);
  const mentionsScript = /멘트|말|대사|스크립트/.test(ins);

  let steps = [...current.steps];
  let scripts = [...current.scripts];
  let dont = current.dont;

  if (isRemove && mentionsDont) {
    dont = '';
  } else if (mentionsScript) {
    scripts = [...scripts, ins].slice(0, 3);
  } else {
    // 기본: 할 일에 한 줄 추가(가장 흔한 수정).
    steps = [...steps, ins].slice(0, MAX_ACTIONS + 2);
  }

  const square = {
    situation: current.situation,
    quagmire: '',
    uncover: '',
    action: { steps, scripts },
    result: { before: '', after: '', metric: '' },
    extract: { do: '', dont },
  };
  const seg: StructuredSegment = {
    category: current.category,
    title: current.title,
    keywords: dedupe([current.title, ...steps].join(' ').split(/\s+/).filter((t) => t.length >= 2)).slice(0, 8),
    square,
  };
  return { square, title: seg.title, keywords: seg.keywords, segments: [seg] };
}

// 의도추출(mock) — 첫 문장 + 2글자 이상 토큰을 키워드로(실 LLM이 군더더기 제거를 정교히).
export function mockExtractIntent(input: IntentInput): IntentOutput {
  const q = input.query.trim();
  const first = q.split(/[.!?\n。]/).map((s) => s.trim()).filter(Boolean)[0] ?? q;
  const keywords = dedupe(q.replace(/[?!.,~]/g, ' ').split(/\s+/).filter((t) => t.length >= 2)).slice(0, 6);
  return { rewritten: first.slice(0, 60), keywords };
}
