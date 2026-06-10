// supabase/functions/ai/index.ts  (Deno / Supabase Edge Function)
// Gemini 호출을 서버에 격리 — 클라이언트는 키를 모름.
// 그라운딩(제공 SOP만) + 양식(responseSchema) + 분량(maxOutputTokens) 을 여기서 강제.
//
// 배포:
//   supabase functions deploy ai
//   supabase secrets set GEMINI_API_KEY=...      (← .env 아님, secrets)
//
// 나중에 Gemini → 자체호스팅(Qwen2.5)로 갈아탈 때 "이 파일만" 바꾸면 됨.

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const MODEL = 'gemini-2.5-flash-lite';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── 양식: 주니어 답변 ResponseBlock 스키마 ──────────────────
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    actions: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    donts: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    used_sop_ids: { type: 'array', items: { type: 'string' } },
    grounded: { type: 'boolean' },
  },
  required: ['summary', 'actions', 'donts', 'used_sop_ids', 'grounded'],
};

// ── 양식: SQUARE 6칸 스키마 ─────────────────────────────────
const SQUARE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    situation: { type: 'string' },
    quagmire: { type: 'string' },
    uncover: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    scripts: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    before: { type: 'string' },
    after: { type: 'string' },
    metric: { type: 'string' },
    do: { type: 'string' },
    dont: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' }, maxItems: 8 },
  },
  // 날조 방지: 원문에서 안 나오는 칸은 required 제외 → 빈 문자열 허용.
  required: ['title', 'situation', 'steps', 'keywords'],
};

async function callGemini(prompt: string, schema: unknown, maxTokens: number) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,            // 결정적 — 창의성 차단
        maxOutputTokens: maxTokens,  // 분량 하드캡
        responseMimeType: 'application/json',
        responseSchema: schema,       // 양식 강제
      },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return JSON.parse(text);
}

// 주니어 답변 — 제공된 SOP만 근거로(그라운딩), 없으면 grounded=false 로 회신.
async function handleAnswer(payload: any) {
  const sops = (payload.sops ?? []) as any[];
  const sopText = sops
    .map((s, i) => `[SOP ${i + 1}] id=${s.id} | 제목: ${s.title}\n상황: ${s.situation}\n단계: ${(s.steps ?? []).join(' / ')}\n금지: ${(s.donts ?? []).join(' / ')}`)
    .join('\n\n');

  const prompt = `너는 매장 운영 어시스턴트다. 아래 "등록된 SOP"에 적힌 내용만 사용해 직원 질문에 답하라.
규칙:
- SOP에 없는 절차/정보는 절대 지어내지 말 것. 근거가 없으면 grounded=false, summary는 빈 문자열로.
- actions 최대 3개, donts 최대 2개. 각 항목은 한 문장.
- 사용한 SOP의 id를 used_sop_ids에 넣을 것(출처).
- 한국어로 간결하게.

[등록된 SOP]
${sopText || '(없음)'}

[직원 질문]
${payload.query}`;

  const out = await callGemini(prompt, ANSWER_SCHEMA, 300);
  const primary = sops[0];
  const grounded = out.grounded !== false && (out.used_sop_ids?.length ?? 0) > 0;

  return {
    grounded,
    usedSopIds: out.used_sop_ids ?? [],
    block: grounded && primary
      ? {
          summary: out.summary,
          actions: out.actions ?? [],
          donts: out.donts ?? [],
          source: {
            entry_id: primary.id,
            creator_name: primary.creatorName,
            title: primary.title,
            version: primary.version,
            updated_at: primary.updatedAt,
          },
        }
      : null,
  };
}

// 사장님 원문 → SQUARE 6칸 구조화.
async function handleSquare(payload: any) {
  const prompt = `사장님이 알려준 매장 노하우 원문을 SQUARE 칸으로 정리하라.
규칙:
- 원문에 있는 내용만 사용. 추측·과장·창작 절대 금지.
- 원문에 근거가 없는 칸(quagmire/uncover/before/after/metric/scripts/do/dont 등)은 빈 문자열("")로 두라. 그럴듯하게 채우지 말 것.
- situation과 steps는 원문에서 반드시 뽑아낸다. 나머지는 있으면 채우고 없으면 비운다.
- 한국어, 각 칸은 짧게.
카테고리 힌트: ${payload.category ?? '미지정'}

[원문]
${payload.rawText}`;

  const r = await callGemini(prompt, SQUARE_SCHEMA, 700);
  return {
    title: r.title,
    keywords: r.keywords ?? [],
    square: {
      situation: r.situation,
      quagmire: r.quagmire,
      uncover: r.uncover,
      action: { steps: r.steps ?? [], scripts: r.scripts ?? [] },
      result: { before: r.before, after: r.after, metric: r.metric },
      extract: { do: r.do, dont: r.dont },
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { task, payload } = await req.json();
    const result = task === 'square' ? await handleSquare(payload) : await handleAnswer(payload);
    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
