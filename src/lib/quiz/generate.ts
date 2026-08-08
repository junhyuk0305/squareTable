// 훈련 퀴즈 v2 — 노하우 → 문항 생성 (클라 진입점)
//
// 흐름: 노하우 → detectKinds(코드 판정) → 형태 선택 → 형태별 엣지 호출 → 레지스트리 검증 → QuizItem[]
//
// ★ 저장하지 않는다. 반환만 한다. DB 쓰기(insertQuizItem)는 db.ts 담당이다(계층 경계).
// ★ supabase.functions.invoke 를 쓰지 않는다 — x-client-info 헤더가 CORS 프리플라이트를
//   깨뜨려 호출이 통째로 죽은 실증이 있다(src/lib/push/notify.ts:42). raw fetch 만 쓴다.
//   (src/lib/ai/client.ts 의 callEdge 와 같은 패턴이지만 그 함수는 export 되지 않아 복제했다.
//    그 파일은 이 작업에서 수정 대상이 아니다.)

import { AI_ENDPOINT, ANON, USE_MOCK } from '@/lib/ai/config';
import { toSopSlice } from '@/lib/ai/adapter';
import type { QuizItemGenInput, QuizItemGenOutput } from '@/lib/ai/types';
import { reportError, track } from '@/lib/analytics/track';
import { supabase } from '@/lib/supabase';
import { genId } from '@/lib/utils/id';
import type { PlaybookEntry } from '@/types';
import { detectKinds, storeTerms } from './detect';
import { FORMATS, formatsForKind } from './formats';
import type { QuizFormat, QuizItem, QuizKind } from './types';

const EDGE_TIMEOUT_MS = 15_000;   // 형태별 스키마가 커서 answer(12초)보다 조금 여유를 둔다
const MAX_ATTEMPTS = 2;           // 최초 1 + 5xx 재시도 1
const RETRY_DELAY_MS = 400;
/** 게임형(묶음형)이 성립하려면 노하우가 이만큼은 있어야 한다. 07-29 §02 "단품형과 묶음형". */
const BUNDLE_MIN_ENTRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 월 AI 한도 초과(엣지 402). 일반 실패와 구분해 던진다 — 캡을 빈 결과로 위장하지 않는다. */
export class QuizQuotaError extends Error {
  constructor(readonly cap: number) { super('ai_quota_exceeded'); }
}

async function callQuizItemEdge(payload: QuizItemGenInput): Promise<QuizItemGenOutput> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('AI edge: no auth session');

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EDGE_TIMEOUT_MS);
    try {
      const res = await fetch(AI_ENDPOINT as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ task: 'quiz_item', payload }),
        signal: ctrl.signal,
      });
      if (res.ok) return (await res.json()) as QuizItemGenOutput;
      if (res.status === 402) {
        // 상태코드만 믿지 않고 판별자까지 확인 — 인프라 계층의 무관한 402가 가짜 페이월이 되지 않게.
        const body = await res.json().catch(() => null);
        if (body?.error === 'ai_quota_exceeded') {
          track('ai_quota_exceeded', { task: 'quiz_item', cap: Number(body?.cap) || 0, used: Number(body?.used) || 0 });
          throw new QuizQuotaError(Number(body?.cap) || 0);
        }
        throw new Error('AI edge quiz_item failed: 402');
      }
      if (res.status < 500) throw new Error(`AI edge quiz_item failed: ${res.status}`);
      lastErr = new Error(`AI edge quiz_item failed: ${res.status}`);
    } catch (e) {
      if (e instanceof QuizQuotaError) throw e;
      if (e instanceof Error && /failed: 4\d\d/.test(e.message)) throw e;
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  throw lastErr;
}

// ── 형태 선택 ──────────────────────────────────────────────
export type QuizItemPlan = { kind: QuizKind; format: QuizFormat };

/** 여러 노하우의 유형을 합친다. 각 노하우에서 앞에 나온(=신뢰도 높은) 유형이 앞으로 온다. */
function unionKinds(entries: PlaybookEntry[]): QuizKind[] {
  const best = new Map<QuizKind, number>();
  for (const e of entries) {
    detectKinds(e).forEach((k, i) => {
      const cur = best.get(k);
      if (cur === undefined || i < cur) best.set(k, i);
    });
  }
  return [...best.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
}

/**
 * 이 노하우들로 만들 형태를 신뢰도 순으로 고른다.
 *
 * 유형마다 게임형을 먼저 쓴다 — 같은 노하우가 세 번째 나올 때 형태가 달라야 복습이 견딘다(07-29 §03).
 * 다만 게임형 중 묶음형은 노하우가 3건 이상 쌓여야 한 판이 되므로, 안 되면 일반형(안전판)으로 떨어진다.
 * 같은 형태를 두 번 넣지 않는다(07-29 §03 "한 판의 구성").
 */
export function pickFormats(entries: PlaybookEntry[], max = 3): QuizItemPlan[] {
  const out: QuizItemPlan[] = [];
  for (const kind of unionKinds(entries)) {
    const specs = formatsForKind(kind);
    if (specs.length === 0) continue;
    const game = specs[specs.length - 1];                       // 레지스트리 순서: 일반형 → 게임형
    const usable = specs.length > 1 && (!game.bundled || entries.length >= BUNDLE_MIN_ENTRIES);
    out.push({ kind, format: (usable ? game : specs[0]).key });
    if (out.length >= max) break;
  }
  return out;
}

// ── 생성 ───────────────────────────────────────────────────
export type GenerateQuizItemsOptions = {
  /** QuizItem.unit_id. 생략하면 빈 문자열 — 저장 직전에 호출부가 채워야 한다. */
  unitId?: string;
  /** QuizItem.created_by. 사장 uid. */
  createdBy?: string;
  /** 형태를 자동 선택할 때 만들 형태 수 상한. 형태 하나당 엣지 1회 = AI 캡 1회 차감. 기본 3. */
  max?: number;
};

/**
 * 노하우에서 문항을 만든다. **저장하지 않는다** — 반환된 QuizItem[] 을 호출부가 db 로 넘긴다.
 *
 * 형태 하나당 엣지를 1회 부른다(캡 1회 차감). 생성은 노하우마다 한 번이고 응시 때는 AI 호출이
 * 0이라, 매번 즉석 생성하던 기존 경로보다 캡을 덜 쓴다.
 *
 * 반환이 빈 배열 = **낼 게 부족해서 안 낸 것**이다(억지 출제 금지 — 07-29). 실패가 아니다.
 * 실패는 throw 로 구분한다:
 *   - QuizQuotaError  : 월 AI 한도 초과. 빈 결과로 위장하지 않는다(캡이 무의미해진다).
 *   - 그 외 Error     : AI 호출이 전부 실패(네트워크·5xx). "노하우가 부실해서"와 다른 상황이다.
 *
 * @param entries 근거 노하우. 여러 건이면 묶음형(줄 잇기·빠른 판별·지뢰 밟기)도 후보가 된다.
 * @param formats 형태 직접 지정. 생략하면 detectKinds 로 판정해 자동 선택(pickFormats).
 */
export async function generateQuizItems(
  entries: PlaybookEntry | PlaybookEntry[],
  formats?: QuizFormat[],
  opts: GenerateQuizItemsOptions = {},
): Promise<QuizItem[]> {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  if (list.length === 0) return [];

  // 데모(mock) 모드에서는 가짜 문항을 만들지 않는다 — 저장되는 물건이라 그대로 매장 데이터가 된다
  // (transcribe·doc_extract 와 같은 이유로 mock 폴백 금지).
  if (USE_MOCK) throw new Error('quiz_item: mock mode');

  const plans = formats?.length
    ? formats.filter((f) => FORMATS[f]).map((f) => ({ kind: FORMATS[f].kind, format: f }))
    : pickFormats(list, opts.max ?? 3);
  if (plans.length === 0) return [];

  const sops = list.map((e) => {
    const s = toSopSlice(e);
    return { id: s.id, title: s.title, situation: s.situation, steps: s.steps, donts: s.donts };
  });
  // 매장 고유 용어 — 이름·초성 형태의 재료. 중복 제거해서 한 번만 싣는다.
  const terms = [...new Set(list.flatMap(storeTerms))].slice(0, 12);
  const known = new Set(list.map((e) => e.id));

  const items: QuizItem[] = [];
  let lastErr: unknown;

  // 순차 호출 — 엣지 레이트리밋이 사용자당 분당 10회다(index.ts RATE_PER_MIN_USER).
  // 병렬로 쏘면 형태 몇 개만 만들어도 429가 난다.
  for (const plan of plans) {
    try {
      const out = await callQuizItemEdge({
        format: plan.format,
        kind: plan.kind,
        sops,
        count: 1,
        ...(terms.length ? { terms } : {}),
      });
      for (const raw of out.items ?? []) {
        const spec = FORMATS[raw.format];
        // 레지스트리가 최종 관문 — 엣지 정규화를 통과했어도 여기서 다시 본다(클라가 채점·표시 SSOT).
        if (!spec || spec.validate(raw.payload)) continue;
        // 근거 노하우는 이번에 보낸 것만 남긴다(엣지가 잘못 환원해도 남의 노하우에 오답이 귀속되지 않게).
        const ids = (raw.entry_ids ?? []).filter((id) => known.has(id));
        if (ids.length === 0) continue;
        items.push({
          id: genId('qi'),
          unit_id: opts.unitId ?? '',
          entry_ids: ids,
          kind: raw.kind,
          format: raw.format,
          payload: raw.payload,
          source: 'ai',
          status: 'active',
          ...(opts.createdBy ? { created_by: opts.createdBy } : {}),
        });
      }
    } catch (e) {
      if (e instanceof QuizQuotaError) throw e;   // 남은 형태를 더 부를 이유가 없다
      lastErr = e;
      console.warn('[quiz] generateQuizItems failed:', plan.format, e);
      reportError('quiz.generateQuizItems.failed', e, { format: plan.format });
    }
  }

  // 하나도 못 만들었는데 호출이 실패했다면 "낼 게 없었다"가 아니라 장애다 — 구분해서 알린다.
  if (items.length === 0 && lastErr) throw lastErr;
  return items;
}
