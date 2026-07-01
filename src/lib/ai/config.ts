// lib/ai/config.ts
// AI 동작 파라미터 단일 진실. "토큰·양식·환각" 제약이 여기서 강제됨.

// 검색 신뢰도 밴드 (하이브리드 라우팅)
//   confidence ≥ SERVE        → 저장된 답 그대로 (LLM 0콜)
//   GENERATE ≤ c < SERVE      → 그라운딩 생성 (이 구간만 LLM)
//   c < GENERATE              → 사장님께 라우팅 (LLM 안 씀)
// SERVE 0.6→0.7 상향(2026-06-28): 실측상 진짜 매칭 0.68~0.77, 애매한 오답(예: 우유노하우 없을 때
// "라떼 거품"→에스프레소 0.648)이 0.6컷을 통과해 자신있게 오답 서빙. 0.7로 올려 애매구간을
// GENERATE(LLM 합성)로 흘려 안전 확보. 파일럿 점수 분포로 재보정(설계 D8).
export const SERVE_THRESHOLD = 0.7;
// GENERATE 0.35→0.45 상향(2026-06-28): 벡터 cosine은 같은 업종이면 0.5~0.6대가 흔해, 0.35는
// 무관한 질문도 GENERATE로 끌어들였다. 0.45로 약한 노이즈를 먼저 쳐내고, 0.45~0.7 애매구간은
// generateAnswer의 그라운딩(SOP에 근거 없으면 grounded=false→사장 라우팅)이 최종으로 거른다.
export const GENERATE_THRESHOLD = 0.45;

// ── SERVE 그라운딩 게이트 (2026-07-01, 격리매장 하니스 튜닝) ───────────────────
// confidence≥SERVE 여도, 자동 확정 답으로 내보낼 노하우(융합 1등)가 "렉시컬(키워드) 1등과
// 일치"하고 근거·마진이 충분할 때만 SERVE 한다. 벡터만 높고 키워드 근거가 0이거나(예:
// "영업 끝나면 정리"→POS) 렉시컬 동점으로 애매하면(예: "혼자 바쁘면"→피크타임 vs 사장부재)
// 자동 확정 대신 GENERATE(여러 노하우 종합 + "AI가 정리한 답" 헤지)로 흘린다.
// 실측(store_eval 15케이스): 거짓SERVE 13.3%→0%, SERVE정밀도 81.8%→100%, 잃은 정답 0.
// ⚠️ 표본이 작다 → 라벨셋을 실쿼리로 키우며 재보정(scripts/eval-knowhow-ops.mjs).
export const SERVE_REQUIRE_LEXICAL_AGREEMENT = true;
export const SERVE_LEX_MIN = 0.05;      // 서빙 엔트리의 최소 렉시컬 근거(키워드 겹침)
export const SERVE_LEX_MARGIN = 0.02;   // 렉시컬 1등−2등 최소 마진(동점 애매 차단)
export const SERVE_VEC_OVERRIDE = 0.2;  // 벡터 1등−2등 마진이 이 이상이면 렉시컬 불일치여도 SERVE(압도적 의미매치 구제밸브)

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
