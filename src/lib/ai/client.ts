// lib/ai/client.ts
// 공급자 추상화. USE_MOCK이면 로컬 mock, 아니면 Supabase Edge Function(`/functions/v1/ai`).
// 나중에 Gemini → 자체호스팅(Qwen2.5) 전환은 Edge Function만 바꾸면 끝 — 여기는 안 건드림.

import type {
  GenerateAnswerInput,
  GenerateAnswerOutput,
  StructureSquareInput,
  StructureSquareOutput,
  PatchSquareInput,
  IntentInput,
  IntentOutput,
  TriageInput,
  TriageOutput,
  TranscribeInput,
  TranscribeOutput,
} from './types';
import { AI_ENDPOINT, ANON, USE_MOCK } from './config';
import { mockGenerateAnswer, mockStructureSquare, mockPatchSquare, mockExtractIntent, mockClassifyQuery } from './mock';
import { isEnglishDominant } from '@/lib/utils/knowhowInput';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/analytics/track';

type Task = 'answer' | 'square' | 'patch' | 'intent' | 'triage' | 'transcribe';

// 한글 입력인데 결과가 통째로 영어로 나왔는지(언어 드리프트). 혼용은 통과(한글 1자라도 있으면 false).
function squareWentEnglish(input: { rawText?: string; instruction?: string }, out: StructureSquareOutput): boolean {
  const src = `${input.rawText ?? ''}${input.instruction ?? ''}`;
  if (!/[가-힣]/.test(src)) return false; // 원문이 한글이 아니면 강제 안 함
  const hay = [out.title, out.square?.situation, ...(out.square?.action?.steps ?? [])].join(' ');
  return isEnglishDominant(hay);
}

// 무한 대기 방지 — 이 시간을 넘기면 중단하고 mock으로 폴백한다.
const EDGE_TIMEOUT_MS = 12_000;
// 받아쓰기는 오디오 업로드(최대 ~2.6MB base64) + 오디오 이해라 텍스트 태스크보다 오래 걸린다.
// 12초 컷이면 60초 발화가 상습적으로 잘린다 → 태스크별 타임아웃.
const EDGE_TIMEOUT_MS_TRANSCRIBE = 30_000;
const timeoutFor = (task: Task) => (task === 'transcribe' ? EDGE_TIMEOUT_MS_TRANSCRIBE : EDGE_TIMEOUT_MS);
// 간헐 5xx 재시도 — flash-lite upstream이 무거운 입력(다중 노하우 등)에서 간헐 500을 뱉는데,
// 그때마다 mock으로 폴백하면 사용자는 덜 정제된 '기본 정리'(degraded)를 받는다. 5xx/네트워크
// 오류만 1회 재시도해 진짜 결과 회복률을 높인다(실측 다중입력 500율 ~1/3 → 재시도로 ~1/9).
// ⚠️ 4xx(401 인증·429 레이트리밋)는 재시도해도 소용없거나 악화 → 즉시 실패시켜 mock 폴백.
const EDGE_MAX_ATTEMPTS = 2;      // 최초 1 + 재시도 1
const EDGE_RETRY_DELAY_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 무료 플랜 월 AI답변 한도 초과(엣지 402 ai_quota_exceeded) — 일반 실패와 구분해 던진다.
// 일반 실패는 mock 폴백(degraded)이지만, 쿼터 초과를 mock 으로 위장하면 캡이 무의미해진다.
class AiQuotaError extends Error {
  constructor() { super('ai_quota_exceeded'); }
}

async function callEdge<T>(task: Task, payload: unknown): Promise<T> {
  // Edge Function 은 "실제 로그인 유저"만 허용(anon 키 호출 거부 → 열린 프록시 방지).
  // apikey 는 게이트웨이용 anon, Authorization 은 로그인 세션의 access_token.
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('AI edge: no auth session');  // → 호출부에서 mock 폴백
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= EDGE_MAX_ATTEMPTS; attempt++) {
    // 응답이 너무 오래 걸리면 끊는다 → 재시도 소진 시 catch에서 mock 폴백(사용자엔 '기본 안내' 고지).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutFor(task));
    try {
      const res = await fetch(AI_ENDPOINT as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ task, payload }),
        signal: ctrl.signal,
      });
      if (res.ok) return (await res.json()) as T;
      // 402 = AI답변 월 쿼터 초과(과금층) — 재시도·mock 폴백 대상이 아닌 별도 신호.
      // 상태코드만 믿지 않고 body 판별자까지 확인 — 인프라 계층의 무관한 402가 가짜 페이월로 둔갑하는 것 방지.
      if (res.status === 402) {
        const body = await res.json().catch(() => null);
        if (body?.error === 'ai_quota_exceeded') throw new AiQuotaError();
        throw new Error(`AI edge ${task} failed: 402`); // 쿼터 외 402 → 일반 4xx(mock 폴백 경로)
      }
      // 4xx는 재시도 무의미 → 즉시 실패(catch에서 4xx로 재-throw됨).
      if (res.status < 500) throw new Error(`AI edge ${task} failed: ${res.status}`);
      // 5xx → 재시도 여지(마지막 시도면 아래서 throw).
      lastErr = new Error(`AI edge ${task} failed: ${res.status}`);
    } catch (e) {
      // 쿼터 초과·4xx로 명시 throw된 건 재시도하지 않는다. 그 외(네트워크/타임아웃/5xx)는 재시도.
      if (e instanceof AiQuotaError) throw e;
      if (e instanceof Error && /failed: 4\d\d/.test(e.message)) throw e;
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < EDGE_MAX_ATTEMPTS) await sleep(EDGE_RETRY_DELAY_MS);
  }
  throw lastErr;  // 재시도 소진 → 호출부에서 mock 폴백(degraded)
}

export async function generateAnswer(
  input: GenerateAnswerInput,
): Promise<GenerateAnswerOutput> {
  if (USE_MOCK) return mockGenerateAnswer(input);
  try {
    return await callEdge<GenerateAnswerOutput>('answer', input);
  } catch (e) {
    // 쿼터 초과는 mock 폴백 금지 — 가짜 답으로 캡을 위장하면 과금층이 무의미해진다.
    // block=null → 호출부(tryGenerate)가 업그레이드 안내 후 후보/사장 라우팅으로 자연 강등.
    if (e instanceof AiQuotaError) {
      return { block: null, grounded: false, usedSopIds: [], quotaExceeded: true };
    }
    // 실호출 실패 시에도 프론트가 죽지 않게 mock으로 폴백(데모 안전망).
    // degraded=true 로 표시해 '진짜 매장 답'이 아니라는 걸 사용자에게 알린다.
    // 원격 관측 — AI 엣지 다운이면 사용자는 mock(가짜 매장답)을 받는데 팀엔 안 보였다(무음 열화). degraded 발생을 계측.
    console.warn('[ai] generateAnswer fallback to mock:', e);
    reportError('ai.generateAnswer.degraded', e);
    return { ...(await mockGenerateAnswer(input)), degraded: true };
  }
}

export async function structureSquare(
  input: StructureSquareInput,
): Promise<StructureSquareOutput> {
  if (USE_MOCK) return mockStructureSquare(input);
  try {
    let out = await callEdge<StructureSquareOutput>('square', input);
    // 한글 입력인데 영어로 나오면 1회 재시도(언어 일관성 보장). 비용보다 품질 우선.
    if (out.usable !== false && squareWentEnglish(input, out)) {
      out = await callEdge<StructureSquareOutput>('square', input);
    }
    return out;
  } catch (e) {
    console.warn('[ai] structureSquare fallback to mock:', e);
    reportError('ai.structureSquare.degraded', e);
    return { ...(await mockStructureSquare(input)), degraded: true };
  }
}

// 인수인계서 대량 파이프(structureDoc) 전용 — 실패 시 mock 폴백 "금지" 버전.
// 채팅(coach)은 폴백이 UX 안전망이지만, 파이프라인이 mock 결과를 받으면 가짜 노하우가
// draft로 조용히 저장된다(무음 오염). 여기선 그대로 throw해 호출부가 청크 단위로
// 재시도/실패 처리하게 한다(429 레이트리밋도 메시지로 구분 가능: "failed: 429").
export async function structureSquareStrict(
  input: StructureSquareInput,
): Promise<StructureSquareOutput> {
  if (USE_MOCK) return mockStructureSquare(input); // 데모 모드는 명시적 mock(가짜임을 아는 경로)
  let out = await callEdge<StructureSquareOutput>('square', input);
  if (out.usable !== false && squareWentEnglish(input, out)) {
    out = await callEdge<StructureSquareOutput>('square', input);
  }
  return out;
}

// 대화형 수정 — 현재 SQUARE + 자연어 수정요청 → 부분 패치된 새 SQUARE(단일).
export async function patchSquare(
  input: PatchSquareInput,
): Promise<StructureSquareOutput> {
  if (USE_MOCK) return mockPatchSquare(input);
  try {
    let out = await callEdge<StructureSquareOutput>('patch', input);
    if (out.usable !== false && squareWentEnglish(input, out)) {
      out = await callEdge<StructureSquareOutput>('patch', input);
    }
    return out;
  } catch (e) {
    console.warn('[ai] patchSquare fallback to mock:', e);
    reportError('ai.patchSquare.degraded', e);
    return { ...(await mockPatchSquare(input)), degraded: true };
  }
}

// 의도 게이트 — 검색 전에 "매장 질문(question) / 잡담·도메인밖(chat) / 대상불명(vague)"을 판정.
// 실패·타임아웃 시 question 으로 fail-open — 게이트 장애가 실질 질문을 막으면 안 된다
// (엣지 handleTriage 의 이상값 fail-open 과 동일 규칙, 클라·서버 이중 방어).
export async function classifyQuery(input: TriageInput): Promise<TriageOutput> {
  if (USE_MOCK) return mockClassifyQuery(input);
  try {
    const out = await callEdge<TriageOutput>('triage', input);
    return ['question', 'chat', 'vague'].includes(out?.type) ? out : { type: 'question' };
  } catch (e) {
    console.warn('[ai] classifyQuery failed (fail-open → question):', e);
    return { type: 'question' };
  }
}

// 음성 받아쓰기 — 녹음(WAV) → 텍스트. 다른 태스크와 달리 mock 폴백을 하지 않는다:
// 가짜 문장을 입력창에 채우면 사용자가 자기가 말한 줄 알고 그대로 전송한다(무음 오염).
// 실패는 실패로 알린다 → 호출부(VoiceInputButton)가 안내 후 타이핑으로 유도.
export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeOutput> {
  if (USE_MOCK) {
    // 데모 모드: 마이크는 동작하지만 STT 백엔드가 없다는 사실을 숨기지 않는다.
    return { text: '', empty: true, error: 'mock_mode' };
  }
  try {
    const out = await callEdge<TranscribeOutput>('transcribe', input);
    const text = String(out?.text ?? '').trim();
    return { text, empty: !text || out?.empty === true, ...(out?.error ? { error: out.error } : {}) };
  } catch (e) {
    console.warn('[ai] transcribeAudio failed:', e);
    reportError('ai.transcribeAudio.failed', e, { durationMs: input.durationMs });
    return { text: '', empty: true, error: 'failed' };
  }
}

// 의도추출 — 장황한 질문에서 검색용 핵심 의도/키워드 추출. 실패 시 빈 결과(호출부가 원쿼리 유지).
export async function extractIntent(input: IntentInput): Promise<IntentOutput> {
  if (USE_MOCK) return mockExtractIntent(input);
  try {
    return await callEdge<IntentOutput>('intent', input);
  } catch (e) {
    console.warn('[ai] extractIntent failed (non-fatal):', e);
    return { rewritten: '', keywords: [] };
  }
}
