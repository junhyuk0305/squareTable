// lib/ai/client.ts
// 공급자 추상화. USE_MOCK이면 로컬 mock, 아니면 Supabase Edge Function(`/functions/v1/ai`).
// 나중에 Gemini → 자체호스팅(Qwen2.5) 전환은 Edge Function만 바꾸면 끝 — 여기는 안 건드림.

import type {
  GenerateAnswerInput,
  GenerateAnswerOutput,
  StructureSquareInput,
  StructureSquareOutput,
} from './types';
import { AI_ENDPOINT, ANON, USE_MOCK } from './config';
import { mockGenerateAnswer, mockStructureSquare } from './mock';
import { supabase } from '@/lib/supabase';

type Task = 'answer' | 'square';

// 무한 대기 방지 — 이 시간을 넘기면 중단하고 mock으로 폴백한다.
const EDGE_TIMEOUT_MS = 12_000;

async function callEdge<T>(task: Task, payload: unknown): Promise<T> {
  // Edge Function 은 "실제 로그인 유저"만 허용(anon 키 호출 거부 → 열린 프록시 방지).
  // apikey 는 게이트웨이용 anon, Authorization 은 로그인 세션의 access_token.
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('AI edge: no auth session');  // → 호출부에서 mock 폴백
  }
  // 응답이 너무 오래 걸리면 끊는다 → catch에서 mock 폴백(사용자엔 '기본 안내'로 고지).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EDGE_TIMEOUT_MS);
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
    if (!res.ok) {
      throw new Error(`AI edge ${task} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateAnswer(
  input: GenerateAnswerInput,
): Promise<GenerateAnswerOutput> {
  if (USE_MOCK) return mockGenerateAnswer(input);
  try {
    return await callEdge<GenerateAnswerOutput>('answer', input);
  } catch (e) {
    // 실호출 실패 시에도 프론트가 죽지 않게 mock으로 폴백(데모 안전망).
    // degraded=true 로 표시해 '진짜 매장 답'이 아니라는 걸 사용자에게 알린다.
    console.warn('[ai] generateAnswer fallback to mock:', e);
    return { ...(await mockGenerateAnswer(input)), degraded: true };
  }
}

export async function structureSquare(
  input: StructureSquareInput,
): Promise<StructureSquareOutput> {
  if (USE_MOCK) return mockStructureSquare(input);
  try {
    return await callEdge<StructureSquareOutput>('square', input);
  } catch (e) {
    console.warn('[ai] structureSquare fallback to mock:', e);
    return { ...(await mockStructureSquare(input)), degraded: true };
  }
}
