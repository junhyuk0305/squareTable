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

type Task = 'answer' | 'square';

async function callEdge<T>(task: Task, payload: unknown): Promise<T> {
  const res = await fetch(AI_ENDPOINT as string, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify({ task, payload }),
  });
  if (!res.ok) {
    throw new Error(`AI edge ${task} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function generateAnswer(
  input: GenerateAnswerInput,
): Promise<GenerateAnswerOutput> {
  if (USE_MOCK) return mockGenerateAnswer(input);
  try {
    return await callEdge<GenerateAnswerOutput>('answer', input);
  } catch (e) {
    // 실호출 실패 시에도 프론트가 죽지 않게 mock으로 폴백(데모 안전망).
    console.warn('[ai] generateAnswer fallback to mock:', e);
    return mockGenerateAnswer(input);
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
    return mockStructureSquare(input);
  }
}
