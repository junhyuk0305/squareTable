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
import { findConfusionPair, type ConfusionPair } from './confusion';
import { changedKinds } from './delta';
import { detectKinds, numericValues, storeTerms } from './detect';
import { FORMATS, formatsForKind } from './formats';
import { MAX_TARGET as FILL_COUNT_MAX } from './formats/fillCount';
import { pairPlan, pairPlanFor } from './pairing';
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
export type QuizItemPlan = {
  kind: QuizKind;
  format: QuizFormat;
  /**
   * 이 형태에만 실을 노하우. 생략하면 호출에 실린 노하우 전부다.
   * 혼동쌍(scale_pick)은 짝 둘만 보여 줘야 모델이 그 둘을 비교한다.
   * 짝짓기(t4)는 판에 오른 노하우 전부가 근거다 — 오답이 그 전부에 귀속된다.
   */
  entries?: PlaybookEntry[];
  /**
   * 우리가 직접 만든 payload. 있으면 **엣지를 부르지 않는다**(AI 캡을 안 먹는다).
   * 지금은 t4 짝짓기만 쓴다 — 짝을 이미 다 계산해서 모델에 물어볼 게 없다(pairing.ts).
   */
  payload?: Record<string, any>;
};

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
 * 노하우 id 로 만드는 안정 해시(FNV-1a). 같은 노하우면 언제나 같은 값이 나온다.
 * ★ Math.random 을 쓰지 않는 이유: 사장이 같은 노하우로 문제를 다시 만들었을 때 형태가 바뀌면
 *   "아까 그거 어디 갔지"가 된다. 노하우가 다르면 형태도 다르고, 같으면 늘 같아야 한다.
 */
function rotationSeed(entries: PlaybookEntry[]): number {
  let h = 2166136261;
  for (const e of entries) {
    for (let i = 0; i < e.id.length; i++) {
      h ^= e.id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/**
 * 이 노하우들로 만들 형태를 신뢰도 순으로 고른다.
 *
 * 유형마다 게임형을 먼저 쓴다 — 같은 노하우가 세 번째 나올 때 형태가 달라야 복습이 견딘다(07-29 §03).
 * 다만 게임형 중 묶음형은 노하우가 3건 이상 쌓여야 한 판이 되므로, 안 되면 일반형(안전판)으로 떨어진다.
 * 같은 형태를 두 번 넣지 않는다(07-29 §03 "한 판의 구성").
 *
 * ★2026-08-24 — 유형당 게임형이 **여럿**이 됐다(t1·t2·t5). 예전에는 `specs[마지막]` 하나만 써서
 *   같은 유형이면 늘 같은 형태가 나왔다 — 그 상태로 형태를 늘리면 렌더러만 늘고 화면은 그대로다.
 *   이제 게임형 후보 중에서 **노하우 id 로 돌려 쓴다**. 호출부(quiz-new)가 노하우 하나씩 max:1 로
 *   부르므로, 회전축이 노하우여야 한 번에 여러 개를 만들 때 형태가 갈린다.
 *
 * ★ 레지스트리 나열 순서 규약에 기댄다: 유형마다 specs[0] 이 일반형(안전판), 그 뒤가 전부 게임형.
 *   formats/index.ts 에 새 형태를 끼워 넣을 때 이 순서를 깨면 여기가 조용히 틀린다.
 */
export function pickFormats(
  entries: PlaybookEntry[],
  max = 3,
  pool: PlaybookEntry[] = entries,
  onlyKinds?: QuizKind[],
): QuizItemPlan[] {
  const out: QuizItemPlan[] = [];
  const seed = rotationSeed(entries);
  // 혼동쌍이 없으면 scale_pick 은 후보가 아니다(아래 games 필터). null 이 정상값이다.
  const pair: ConfusionPair | null = findConfusionPair(entries, pool);

  // ★ t4 짝짓기의 판정은 여기서 한다 — detectKinds 는 노하우 **한 건**만 보는데 짝은 **여러 건**이
  //   있어야 성립하기 때문이다(같은 카테고리·같은 단위·서로 다른 값 3건 이상). 그래서 detectKinds 를
  //   여러 건 받는 함수로 바꾸지 않고, 노하우들과 pool 을 이미 손에 쥔 이 자리에서 유형 목록에 얹는다.
  // ★ 맨 앞에 둔다. 재료 조건이 좁아 성립하는 일이 드물고, 한 판은 세트에서 id 가 가장 작은 노하우
  //   **한 건**에서만 나오므로(pairing.ts) 뒤에 두면 max:1 인 호출부(quiz-new)에서 영영 안 나온다.
  // ★ 노출 조건은 재료뿐이다 — "노하우 N건 이상" 같은 조건을 걸지 않는다(사용자 확정 08-24).
  const t4 = pairPlan(entries, pool, seed);
  const kinds = unionKinds(entries);
  if (t4) kinds.unshift('t4');

  // 델타 출제 — 바뀐 칸만 남긴다. 걸러 낸 뒤가 비면 계획도 비고, 그러면 아무것도 안 낸다.
  // ★ 신뢰도 순서(unionKinds)는 그대로 둔다 — 무엇을 낼지만 좁히지, 어떤 형태로 낼지는 안 바꾼다.
  const wanted = onlyKinds?.length ? kinds.filter((k) => onlyKinds.includes(k)) : kinds;

  for (const kind of wanted) {
    if (t4 && kind === 't4') {
      out.push({ kind, ...t4 });
      if (out.length >= max) break;
      continue;
    }
    const specs = formatsForKind(kind);
    if (specs.length === 0) continue;
    const games = specs.slice(1).filter((f) => {
      // ★ scale_pick 은 "비슷한데 값이 다른" 노하우 두 건이 있어야 성립한다. 쌍이 없는데 뽑으면
      //   모델이 낼 게 없어 빈 배열을 돌려주고, 사장 화면에는 이유 없이 "만들지 못했어요"만 남는다.
      if (f.key === 'scale_pick') return pair !== null;
      // ★ numeric_entry 는 **탭으로 못 올리는 큰 값**이 노하우에 있어야 성립한다(fill_count 의 상한이 12).
      //   없는데 뽑으면 엣지 normalize 가 전부 버려 빈 배열이 오고, 사장 화면에는 이유 없이
      //   "만들지 못했어요"만 남는다 — scale_pick 이 같은 이유로 t2 노하우 절반을 조용히
      //   실패시키던 함정과 **같은 것**이다. 형태를 늘릴 때마다 이 자리를 같이 본다.
      if (f.key === 'numeric_entry') return entries.some((e) => numericValues(e).some((n) => n.value > FILL_COUNT_MAX));
      // 묶음형은 노하우가 모자라면 한 판이 안 된다 — 후보에서 먼저 뺀다.
      return !f.bundled || entries.length >= BUNDLE_MIN_ENTRIES;
    });
    const chosen = games.length > 0 ? games[seed % games.length] : specs[0];
    out.push({
      kind,
      format: chosen.key,
      ...(chosen.key === 'scale_pick' && pair ? { entries: pair } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 사장이 형태를 직접 고른 경로(QuizEditorSheet)의 계획 1건.
 *
 * t4 는 재료가 맞으면 우리가 payload 까지 만들고, 안 맞으면 계획만 세워 엣지로 넘긴다 —
 * 우리 추출기는 **수치 짝**만 보지만 모델은 수치가 아닌 짝(물건 ↔ 두는 자리, 용어 ↔ 뜻)도
 * 찾을 수 있기 때문이다(flipMatch.aiHint). 자동 출제(pickFormats)는 그 반대로,
 * 우리가 만들 수 있을 때만 t4 를 낸다.
 */
function planFor(format: QuizFormat, list: PlaybookEntry[], pool: PlaybookEntry[]): QuizItemPlan {
  const kind = FORMATS[format].kind;
  if (kind !== 't4') return { kind, format };
  const made = pairPlanFor(format, list, pool);
  return made ? { kind, ...made } : { kind, format };
}

// ── 생성 ───────────────────────────────────────────────────
export type GenerateQuizItemsOptions = {
  /** QuizItem.unit_id. 생략하면 빈 문자열 — 저장 직전에 호출부가 채워야 한다. */
  unitId?: string;
  /** QuizItem.created_by. 사장 uid. */
  createdBy?: string;
  /** 형태를 자동 선택할 때 만들 형태 수 상한. 형태 하나당 엣지 1회 = AI 캡 1회 차감. 기본 3. */
  max?: number;
  /**
   * 혼동쌍(scale_pick)의 짝을 찾을 후보 풀. 생략하면 entries 안에서만 찾는다.
   * ★ **이번 코스에 함께 담긴 노하우**를 넘겨라. 코스 밖 노하우를 짝으로 쓰면 문항의 근거
   *   노하우가 코스에 없는 상태가 되어 오답 귀속(0103)·복습 연결이 어긋난다.
   */
  pool?: PlaybookEntry[];
  /**
   * **델타 출제** — 이 노하우로 이미 만들어 둔 문항들. 주면 통째로 다시 만들지 않고
   * **근거가 실제로 달라진 칸만** 만든다(delta.ts · 07-29 §06 "변경").
   *
   * ★ 형태를 직접 지정한 경로(사장이 고른 것)에는 적용하지 않는다 — 사장이 고른 것을
   *   코드가 지우면 "눌렀는데 아무것도 안 나온다"가 된다. 자동 선택일 때만 좁힌다.
   */
  existing?: QuizItem[];
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
 *
 * ★ `opts.existing` 을 주면 **델타 출제**가 켜진다 — 기존 문항 중 근거가 실제로 달라진 것의
 *   칸만 다시 만든다. 달라진 칸이 없으면 빈 배열이다(= 다시 물을 게 없다).
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

  const pool = opts.pool?.length ? opts.pool : list;
  // 델타 출제 — 바뀐 칸이 없으면 **여기서 조용히 끝난다**(빈 결과 = 낼 게 없다, 실패가 아니다).
  const delta = !formats?.length && opts.existing?.length ? changedKinds(list, opts.existing) : null;
  if (delta && delta.length === 0) return [];
  const plans: QuizItemPlan[] = formats?.length
    ? formats.filter((f) => FORMATS[f]).map((f) => planFor(f, list, pool))
    : pickFormats(list, Math.min(opts.max ?? 3, delta?.length ?? Infinity), pool, delta ?? undefined);
  if (plans.length === 0) return [];

  const sopsOf = (es: PlaybookEntry[]) =>
    es.map((e) => {
      const s = toSopSlice(e);
      return { id: s.id, title: s.title, situation: s.situation, steps: s.steps, donts: s.donts };
    });
  // 매장 고유 용어 — 이름·초성 형태의 재료. 중복 제거해서 한 번만 싣는다.
  const terms = [...new Set(list.flatMap(storeTerms))].slice(0, 12);
  // 혼동쌍은 짝 한쪽이 list 밖(같은 코스의 다른 노하우)일 수 있다 — 그것도 아는 노하우로 친다.
  const known = new Set([...list, ...plans.flatMap((p) => p.entries ?? [])].map((e) => e.id));

  const items: QuizItem[] = [];
  let lastErr: unknown;

  // 순차 호출 — 엣지 레이트리밋이 사용자당 분당 10회다(index.ts RATE_PER_MIN_USER).
  // 병렬로 쏘면 형태 몇 개만 만들어도 429가 난다.
  for (const plan of plans) {
    // 우리가 만든 payload(t4 짝짓기)는 엣지를 부르지 않는다 — 짝을 이미 다 알아서 물어볼 게 없다.
    // 레지스트리 검증은 AI 결과와 똑같이 통과해야 한다(우리가 만들었다고 봐주지 않는다).
    if (plan.payload) {
      if (FORMATS[plan.format].validate(plan.payload)) continue;
      items.push({
        id: genId('qi'),
        unit_id: opts.unitId ?? '',
        entry_ids: (plan.entries?.length ? plan.entries : list).map((e) => e.id),
        kind: plan.kind,
        format: plan.format,
        payload: plan.payload,
        source: 'ai',
        status: 'active',
        ...(opts.createdBy ? { created_by: opts.createdBy } : {}),
      });
      continue;
    }
    try {
      const out = await callQuizItemEdge({
        format: plan.format,
        kind: plan.kind,
        sops: sopsOf(plan.entries?.length ? plan.entries : list),
        count: 1,
        ...(terms.length ? { terms } : {}),
      });
      for (const raw of out.items ?? []) {
        const spec = FORMATS[raw.format];
        // 레지스트리가 최종 관문 — 엣지 정규화를 통과했어도 여기서 다시 본다(클라가 채점·표시 SSOT).
        if (!spec || spec.validate(raw.payload)) continue;
        // 근거 노하우는 이번에 보낸 것만 남긴다(엣지가 잘못 환원해도 남의 노하우에 오답이 귀속되지 않게).
        // ★ 혼동쌍은 두 노하우가 있어야 성립하므로 근거를 둘 다에 귀속시킨다. 엣지 quizFormats 는
        //   scale_pick 을 bundled 로 표시하지 않아 source_index 로 한쪽만 찍어 온다 — 여기서 바로잡는다.
        const ids = plan.entries?.length
          ? plan.entries.map((e) => e.id)
          : (raw.entry_ids ?? []).filter((id) => known.has(id));
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
