// 노하우 품질 실통신 평가 — pilot 계정 로그인 → 실 Edge Function(ai) 직접 호출 → 케이스 출력.
// 사용: node scripts/qa-knowhow-eval.mjs
// 평가표: 루트 노하우_품질_평가표_v1.md (사람이 출력 보고 채점).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

function parseEnv(f) {
  const o = {};
  try {
    for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^([A-Z_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].trim();
    }
  } catch {}
  return o;
}
const env = parseEnv(here('../.env'));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
// 자격증명은 환경변수로만(레포에 비번 박지 않음): QA_EMAIL=… QA_PASSWORD=… node scripts/qa-knowhow-eval.mjs
const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
if (!URL_ || !ANON) { console.error('env(.env) 누락'); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error('QA_EMAIL / QA_PASSWORD 환경변수를 설정하세요(파일럿 계정).'); process.exit(1); }

async function signIn() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function callAI(token, task, payload) {
  const t0 = Date.now();
  const res = await fetch(`${URL_}/functions/v1/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ task, payload }),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ms: Date.now() - t0, body: j };
}

// extraction-master 지침을 그대로 실어 보낸다(클라와 동일 조건).
async function loadGuide() {
  const src = readFileSync(here('../src/data/extraction-master.ts'), 'utf8');
  const m = src.match(/export const EXTRACTION_MASTER = `([\s\S]*?)`;/);
  return m ? m[1] : '';
}

function show(label, r) {
  console.log(`\n──────── ${label}  [${r.status} · ${r.ms}ms] ────────`);
  if (!r.ok) { console.log('ERROR', JSON.stringify(r.body)); return; }
  const b = r.body;
  if (b.segments) {
    console.log('category:', b.segments.map((s) => s.category).join(', '), '| segments:', b.segments.length);
    console.log('title   :', b.title);
    console.log('situation:', b.square?.situation);
    console.log('steps   :', JSON.stringify(b.square?.action?.steps));
    console.log('scripts :', JSON.stringify(b.square?.action?.scripts));
    console.log('dont    :', b.square?.extract?.dont);
    console.log('scale   :', JSON.stringify(b.scalePrompt));
    console.log('FOLLOWUPS:', JSON.stringify(b.followups));
  } else if (b.rewritten !== undefined) {
    console.log('rewritten:', b.rewritten);
    console.log('keywords :', JSON.stringify(b.keywords));
  } else {
    console.log(JSON.stringify(b, null, 2).slice(0, 800));
  }
  if (b.usage) console.log('tokens  :', b.usage.totalTokenCount ?? JSON.stringify(b.usage));
}

const main = async () => {
  const guide = await loadGuide();
  const token = await signIn();
  console.log('✓ 로그인 성공 (', EMAIL, ')');

  // ── A. 등록(square + followups) ──
  console.log('\n\n========== A. 등록 (square / followups) ==========');
  const A = {
    A1: '커피 적당히 넣어',
    A2: '여분 시럽은 창고 맨 위 칸에 있어',
    A3: '고기 익으면 뒤집어',
    A4: '마감',
    A5: '아침에 그라인더 청소하고 원두 채워. 진상 손님 오면 매니저 불러',
  };
  const aOut = {};
  for (const [k, rawText] of Object.entries(A)) {
    const r = await callAI(token, 'square', { rawText, category: 'Routine', categoryGuide: guide });
    aOut[k] = r;
    show(`A.${k}  "${rawText}"`, r);
  }

  // ── A 재정리(2차) — A1/A3/A4에 가상의 답변을 합쳐 skipFollowups ──
  console.log('\n\n========== A′. 재정리 (skipFollowups, 꼬리질문 답 합침) ==========');
  const refineCases = {
    A1: '커피 적당히 넣어\n\n[추가 설명]\n- 무슨 커피예요?\n  → 에스프레소\n- 몇 샷이 기준이에요?\n  → 2샷',
    A4: '마감\n\n[추가 설명]\n- 마감 때 무엇을 하나요?\n  → 그릴 끄고 기름통 비우고 바닥 쓸기',
  };
  for (const [k, rawText] of Object.entries(refineCases)) {
    const r = await callAI(token, 'square', { rawText, category: 'Routine', categoryGuide: guide, skipFollowups: true });
    show(`A′.${k} 재정리`, r);
  }

  // ── B. 수정(patch) ──
  console.log('\n\n========== B. 수정 (patch / 부분 패치·보존) ==========');
  const current = { title: '마감 청소', category: 'Routine', situation: '마감 시', steps: ['그릴 끄기', '바닥 쓸기'], scripts: [], dont: '가스 안 끄고 가기' };
  const B = {
    B1: "할 일에 '행주 삶기' 추가해줘",
    B2: '금지는 빼줘',
    B3: "바닥 쓸기를 '바닥 물청소'로 바꿔줘",
    B4: "제목을 '마감 마무리'로 바꿔줘",
  };
  for (const [k, instruction] of Object.entries(B)) {
    const r = await callAI(token, 'patch', { instruction, current, categoryGuide: guide });
    show(`B.${k}  "${instruction}"`, r);
  }

  // ── C. 답변(intent) ──
  console.log('\n\n========== C. 답변 (intent / 의도추출) ==========');
  const C = {
    C1: '어제 손님이 화나서 환불해달라고 했는데 이런 건 어떻게 해요?',
    C2: '그… 마감하고 나서 바닥이랑 그런 거 어디까지 치워야 되나요 보통?',
    C3: '앞치마요',
  };
  for (const [k, query] of Object.entries(C)) {
    const r = await callAI(token, 'intent', { query });
    show(`C.${k}  "${query}"`, r);
  }

  console.log('\n\n✓ 완료 — 위 출력을 노하우_품질_평가표_v1.md 기준으로 채점하세요.');
};

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
