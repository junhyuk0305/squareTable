// 노하우 다중 등록 — 실통신 QA (라이브 증명).
// pilot 로그인 → 실 Edge(ai·square) 호출로 실제 분리 개수를 받고, 클라 정책(MAX_SPLIT_PUBLISH=5 +
// isSquarePublishable + overflow 경고)을 그대로 적용해 "최종 발행 N개 / 경고 여부"를 검증한다.
// square 태스크는 DB에 쓰지 않는다(embed만 씀) → 데이터 오염 없음.
//
// 사용: QA_EMAIL=owner@pilot.squaretable.app QA_PASSWORD=pilot1234 node scripts/qa-knowhow-multi.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
function parseEnv(f) {
  const o = {};
  try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch {}
  return o;
}
const env = parseEnv(here('../.env'));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
if (!URL_ || !ANON) { console.error('env(.env) 누락'); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error('QA_EMAIL / QA_PASSWORD 환경변수 필요(파일럿 계정).'); process.exit(1); }

// ── 클라 정책 미러(OwnerCoachChat / buildEntry와 동일 규칙) ──
const MAX_SPLIT_PUBLISH = 5;
const isPub = (s) => ((s?.square?.action?.steps?.length || 0) >= 1) || ((s?.square?.action?.scripts?.length || 0) >= 1);

async function signIn() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
// 실 클라(client.ts callEdge)와 동일: 5xx/네트워크 오류만 1회 재시도, 4xx는 즉시 실패.
const RETRY = process.env.QA_NORETRY ? 1 : 2; // QA_NORETRY=1 이면 재시도 없이(대조군)
async function callSquare(token, guide, rawText) {
  const t0 = Date.now();
  let retries = 0;
  for (let attempt = 1; attempt <= RETRY; attempt++) {
    let res, j;
    try {
      res = await fetch(`${URL_}/functions/v1/ai`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ task: 'square', payload: { rawText, category: 'Routine', categoryGuide: guide } }),
      });
      j = await res.json().catch(() => ({}));
    } catch (e) {
      if (attempt < RETRY) { retries++; await new Promise((r) => setTimeout(r, 400)); continue; }
      return { ok: false, status: 0, ms: Date.now() - t0, body: { error: String(e) }, retries };
    }
    if (res.ok) return { ok: true, status: res.status, ms: Date.now() - t0, body: j, retries };
    if (res.status < 500) return { ok: false, status: res.status, ms: Date.now() - t0, body: j, retries }; // 4xx 즉시
    if (attempt < RETRY) { retries++; await new Promise((r) => setTimeout(r, 400)); continue; } // 5xx 재시도
    return { ok: false, status: res.status, ms: Date.now() - t0, body: j, retries };
  }
}
function loadGuide() {
  const src = readFileSync(here('../src/data/extraction-master.ts'), 'utf8');
  return src.match(/export const EXTRACTION_MASTER = `([\s\S]*?)`;/)?.[1] ?? '';
}

let failed = 0;
const ok = (n) => console.log(`    ✓ ${n}`);
const bad = (n, d) => { failed++; console.log(`    ✗ ${n} → ${d}`); };
const assert = (c, n, d) => (c ? ok(n) : bad(n, d));

// 케이스: [라벨, 원문, 기대(감지 하한, overflow 기대)]
const CASES = [
  ['M1 · 3개 나열', '1. 오픈하면 화장실 청소\n2. 마감 때 포스기 정산\n3. 재고 확인하고 부족하면 발주', { minDetect: 3, overflow: false }],
  ['M2 · 5개(경계)', '1. 오픈 매장 청소\n2. 그라인더 청소하고 원두 채우기\n3. 마감 포스기 정산\n4. 진상 손님 오면 매니저 호출\n5. 마감 재고 확인', { minDetect: 5, overflow: false }],
  ['M3 · 6개(초과 경계)', '1. 오픈 매장 청소\n2. 그라인더 청소하고 원두 채우기\n3. 마감 포스기 정산\n4. 진상 손님 오면 매니저 호출\n5. 마감 재고 확인\n6. 간판 불 끄기', { minDetect: 6, overflow: true }],
  ['M4 · 10개', Array.from({ length: 10 }, (_, i) => `${i + 1}. ${['오픈 청소','원두 채우기','포스기 정산','매니저 호출','재고 확인','간판 끄기','냉장고 온도 체크','쓰레기 배출','우유 발주','바닥 물청소'][i]}`).join('\n'), { minDetect: 6, overflow: true }],
  ['M5 · 긴 인수인계서', [
    '인수인계 사항 정리합니다.',
    '오픈은 8시에 하고, 들어오면 제일 먼저 에어컨이랑 음악을 켭니다.',
    '그라인더는 매일 아침 청소하고 원두를 가득 채워주세요.',
    '점심 피크 전에 시럽류 재고를 확인하고, 모자라면 사장한테 바로 문자 주세요.',
    '손님이 음료 식었다고 하면 군말 없이 새로 만들어 드립니다.',
    '진상 손님은 절대 직접 상대하지 말고 매니저를 부르세요.',
    '마감은 10시에 하고, 포스기 정산 후 현금은 금고에 넣습니다.',
    '마감 청소는 그릴 끄고 기름통 비우고 바닥 물청소까지 합니다.',
    '락커 비밀번호는 1234이고, 여분 컵은 창고 맨 위 칸에 있습니다.',
    '배달 앱은 9시 반에 미리 닫아두세요.',
  ].join('\n'), { minDetect: 6, overflow: true }],
  ['M6 · 단일(대조군)', '우유 거품은 곱게 올려야 라떼아트가 잘 나와', { minDetect: 1, overflow: false }],
];

const ONLY = process.env.QA_ONLY;       // 라벨 부분일치 필터(진단용)
const REPEAT = Number(process.env.QA_REPEAT || 1); // 각 케이스 반복 횟수(결정성 확인)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const guide = loadGuide();
  const token = await signIn();
  console.log(`✓ 로그인 (${EMAIL}) · 가이드 ${guide.length}자\n`);

  let totalTokens = 0;
  const runList = [];
  for (const c of CASES) { if (!ONLY || c[0].includes(ONLY)) for (let k = 0; k < REPEAT; k++) runList.push(c); }
  for (const [label, rawText, exp] of runList) {
    const r = await callSquare(token, guide, rawText);
    if (REPEAT > 1) await sleep(2500); // 레이트리밋(10/분) 여유
    console.log(`──────── ${label}  [${r.status} · ${r.ms}ms${r.retries ? ` · 재시도 ${r.retries}회` : ''}] ────────`);
    if (!r.ok) { bad(label, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); console.log(''); continue; }
    const b = r.body;
    const segs = Array.isArray(b.segments) ? b.segments : [];
    const detected = segs.length;
    const pub = segs.filter(isPub);
    const overflow = pub.length > MAX_SPLIT_PUBLISH;
    const published = pub.slice(0, MAX_SPLIT_PUBLISH);
    totalTokens += b.usage?.totalTokenCount || 0;

    console.log(`  edge 감지(segments): ${detected}  |  발행가능(pub): ${pub.length}  |  최종 발행: ${published.length}  |  경고: ${overflow ? '⚠️ 예' : '아니오'}`);
    console.log('  제목:', segs.map((s, i) => `${i + 1})${s.title || '∅'}${isPub(s) ? '' : '·비발행'}`).join('  '));
    console.log('  카테고리:', segs.map((s) => s.category).join(', '));
    if (b.usage) console.log('  tokens:', b.usage.totalTokenCount);

    // 검증
    if (label.startsWith('M6')) {
      assert(detected <= 1 || pub.length <= 1, 'M6 단일 → 분리 안 됨(1개)', `pub=${pub.length}`);
    } else {
      assert(detected >= 2, `분리 감지(≥2)`, `detected=${detected} (edge가 안 나눔 — 배포 가이드 절단 의심)`);
    }
    assert(published.length <= MAX_SPLIT_PUBLISH, `최종 발행 ≤ ${MAX_SPLIT_PUBLISH}`, `published=${published.length}`);
    if (exp.overflow) {
      assert(overflow === true, '초과 → 경고 발생', `detected=${detected} pub=${pub.length} (6+ 감지 실패 시 경고 안 뜸)`);
      assert(published.length === MAX_SPLIT_PUBLISH, `초과 시 정확히 ${MAX_SPLIT_PUBLISH}개 발행`, `published=${published.length}`);
    } else if (exp.minDetect <= 5 && !label.startsWith('M6')) {
      assert(overflow === false, '경계 이하 → 경고 없음', `overflow=${overflow}`);
    }
    console.log('');
  }

  console.log(`총 토큰: ${totalTokens}`);
  console.log(`\n${failed === 0 ? '✅ PASS' : `❌ FAIL (${failed})`} — 노하우 다중 등록 실통신 QA\n`);
  process.exit(failed === 0 ? 0 : 1);
};
main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
