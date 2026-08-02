// 문서 텍스트 추출(doc_extract) 엣지 QA — 실 백엔드 대상. DB에 아무것도 안 씀(오염 없음).
//
// 이 하니스가 지키는 핵심 불변식:
//   ① doc_extract 는 AI 답변 캡을 "차감하지 않는다"(transcribe 와 같은 '입력 수단' 등급).
//      엣지 라우팅은 `isAnswer = !denylist.includes(task)` 구조라 denylist 에 빠뜨리면
//      조용히 answer 취급 → 캡을 갉아먹고 handleAnswer 로 잘못 라우팅된다.
//   ② PDF(application/pdf)만 받는다 — 그 외 mime 거절.
//   ③ 페이로드 하드캡(base64 14MB) 초과 거절 — 비용 DoS 방어선.
//   ④ 텍스트 PDF 에서 본문이 그대로 나온다(요약·의역 없음 — 핵심어 보존으로 검증).
//   ⑤ 스캔(이미지만 든) PDF 도 한국어 본문이 나온다 — 내장 OCR 경로 실증.
//
// 픽스처 재생성: node scripts/fixtures/make-doc-fixtures.mjs (Windows — 스캔 JPEG 은 System.Drawing)
// 사용: QA_EMAIL=... QA_PASSWORD=... node scripts/qa-import-pdf.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
function parseEnv(f) { const o = {}; try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch {} return o; }
const env = parseEnv(here('../.env'));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.QA_EMAIL, PASSWORD = process.env.QA_PASSWORD;
if (!URL_ || !ANON) { console.error('env(.env) 누락'); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error('QA_EMAIL / QA_PASSWORD 환경변수 필요(파일럿 계정).'); process.exit(1); }

let pass = 0, fail = 0, skip = 0;
const chk = (c, n, d) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' → ' + d : ''}`); } };
const note = (n, d) => { skip++; console.log(`  – ${n}${d ? ' → ' + d : ''} (SKIP)`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function call(token, task, payload) {
  const res = await fetch(`${URL_}/functions/v1/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ task, payload }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

// 현재 KST 월의 AI 답변 사용량 — qa-transcribe 와 동일 판독(RLS 로 내 매장 행만).
async function usedNow(token) {
  const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const res = await fetch(`${URL_}/rest/v1/ai_usage_monthly?select=used&month=eq.${month}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? Number(rows[0].used ?? 0) : 0;
}

async function quotaMeterLive(token) {
  const fm = await fetch(`${URL_}/rest/v1/rpc/billing_free_mode`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` }, body: '{}' });
  const freeMode = await fm.json().catch(() => null);
  if (freeMode !== false) return { live: false, why: 'billing_free_mode=true' };
  const sres = await fetch(`${URL_}/rest/v1/unit_subscriptions?select=plan`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  const rows = await sres.json().catch(() => []);
  const plan = Array.isArray(rows) && rows[0] ? (rows[0].plan ?? 'free') : 'free';
  return plan === 'free' ? { live: true } : { live: false, why: `plan=${plan}(무제한)` };
}

const b64Of = (rel) => readFileSync(here(rel)).toString('base64');

(async () => {
  const token = await signIn();
  console.log('\n[1] 인증·입력 검증');

  const textPdf = b64Of('./fixtures/qa-doc-text.pdf');
  const scanPdf = b64Of('./fixtures/qa-doc-scan.pdf');

  const noAuth = await call(null, 'doc_extract', { mimeType: 'application/pdf', docBase64: textPdf });
  chk(noAuth.status === 401, '미인증 호출 거부(401)', `status=${noAuth.status}`);

  const badMime = await call(token, 'doc_extract', { mimeType: 'text/plain', docBase64: textPdf });
  chk(badMime.body?.error === 'unsupported_doc', 'PDF 외 mime 거절', JSON.stringify(badMime.body).slice(0, 120));

  // 14MB 초과 — 실제 PDF 를 만들 필요 없이 base64 길이만 넘기면 된다(하드캡은 길이로 판정).
  const tooBig = await call(token, 'doc_extract', { mimeType: 'application/pdf', docBase64: 'A'.repeat(14_000_001) });
  chk(tooBig.body?.error === 'doc_too_large', '페이로드 하드캡(14MB) 초과 거절', JSON.stringify(tooBig.body).slice(0, 120));

  const emptyPayload = await call(token, 'doc_extract', { mimeType: 'application/pdf', docBase64: '' });
  chk(emptyPayload.body?.empty === true && !emptyPayload.body?.text, '빈 문서 → empty=true(모델 호출 없음)');

  console.log('\n[2] 텍스트 PDF — 본문이 그대로 추출되는가');
  await sleep(1200); // 분당 레이트리밋(사용자 10) 여유
  const t = await call(token, 'doc_extract', { mimeType: 'application/pdf', docBase64: textPdf });
  const tText = String(t.body?.text ?? '');
  chk(t.ok && t.body?.empty === false && tText.length > 20, '텍스트 PDF → 텍스트가 나온다', `status=${t.status} ${JSON.stringify(t.body).slice(0, 160)}`);
  for (const w of ['Preheat', 'grinder', '200ml']) {
    chk(tText.toLowerCase().includes(w.toLowerCase()), `핵심어 보존: ${w}`, tText.slice(0, 120));
  }

  console.log('\n[3] 스캔 PDF(이미지만) — 내장 OCR 로 한국어가 읽히는가');
  await sleep(1200);
  const s = await call(token, 'doc_extract', { mimeType: 'application/pdf', docBase64: scanPdf });
  const sText = String(s.body?.text ?? '');
  chk(s.ok && s.body?.empty === false && sText.length > 20, '스캔 PDF → 텍스트가 나온다', `status=${s.status} ${JSON.stringify(s.body).slice(0, 160)}`);
  for (const w of ['머신', '그라인더', '시럽', '행주']) {
    chk(sText.includes(w), `핵심어 보존: ${w}`, sText.slice(0, 120));
  }
  // 소제목 규격 — 클라 청커가 섹션 경계로 인식하려면 "[제목]"이 **단독 줄**이어야 한다.
  // 평문 스키마 시절 모델이 개행을 버리고 공백으로 이어 붙인 회귀(2026-08-02 실측)의 재발 방지.
  chk(/^\[오픈\]$/m.test(sText), '소제목 [오픈] 단독 줄 규격', JSON.stringify(sText.slice(0, 120)));
  chk(sText.includes('\n'), '개행 보존(한 덩어리 아님)', JSON.stringify(sText.slice(0, 120)));

  console.log('\n[4] ★ 쿼터 미차감 — doc_extract 는 AI 답변 캡을 갉지 않는다');
  const meter = await quotaMeterLive(token);
  if (!meter.live) {
    note('쿼터 카운터 비활성 계정이라 차감 비교 불가', meter.why);
  } else {
    const before = await usedNow(token);
    await sleep(1200);
    await call(token, 'doc_extract', { mimeType: 'application/pdf', docBase64: textPdf });
    await sleep(800);
    const afterD = await usedNow(token);
    chk(afterD === before, 'doc_extract 후 used 불변', `${before} → ${afterD}`);

    // 대조군 — 같은 계정의 answer 1건은 카운터를 올린다(=계측이 살아 있다는 증거).
    await sleep(1200);
    await call(token, 'answer', {
      query: '마감 청소 어떻게 해요?',
      sops: [{ id: 'sop_qa_d', title: '마감 청소', category: 'Routine', situation: '영업 마감 후', steps: ['바닥을 청소한다'], donts: [], scripts: [], creatorName: '사장님', version: 1, updatedAt: '2026-07-01T00:00:00Z' }],
    });
    await sleep(800);
    const afterA = await usedNow(token);
    chk(afterA === afterD + 1, '대조군: answer 1건은 used +1 (카운터 살아있음)', `${afterD} → ${afterA}`);
  }

  console.log(`\n결과: PASS ${pass} · FAIL ${fail}${skip ? ` · SKIP ${skip}` : ''}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('하니스 오류:', e); process.exit(1); });
