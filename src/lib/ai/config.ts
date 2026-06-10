// lib/ai/config.ts
// AI 동작 파라미터 단일 진실. "토큰·양식·환각" 제약이 여기서 강제됨.

// 검색 신뢰도 밴드 (하이브리드 라우팅)
//   confidence ≥ SERVE        → 저장된 답 그대로 (LLM 0콜)
//   GENERATE ≤ c < SERVE      → 그라운딩 생성 (이 구간만 LLM)
//   c < GENERATE              → 사장님께 라우팅 (LLM 안 씀)
export const SERVE_THRESHOLD = 0.6;
export const GENERATE_THRESHOLD = 0.35;

// 출력 분량 상한 — API 레벨에서 강제(max_output_tokens) + 스키마 항목 수 제한
export const MAX_OUTPUT_TOKENS_ANSWER = 300;
export const MAX_OUTPUT_TOKENS_SQUARE = 700;
export const MAX_ACTIONS = 3;   // 액션 최대 3개
export const MAX_DONTS = 2;     // 금지사항 최대 2개

// 생성 파라미터 — 결정적으로(창의성 죽임)
export const TEMPERATURE = 0.2;
export const MODEL = 'gemini-2.5-flash-lite';

// ── 공급자 라우팅 ────────────────────────────────────────────
// 비밀키(GEMINI)는 클라이언트에 없음 → 실호출은 Supabase Edge Function 경유.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const AI_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai` : null;
export const ANON = ANON_KEY;

// USE_MOCK=true 이거나 엔드포인트 미설정이면 로컬 mock으로 동작(프론트 안 끊김).
export const USE_MOCK =
  process.env.EXPO_PUBLIC_USE_MOCK === 'true' || !AI_ENDPOINT || !ANON_KEY;
