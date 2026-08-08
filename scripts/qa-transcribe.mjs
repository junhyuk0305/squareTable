// 음성 받아쓰기(transcribe) 엣지 QA — 실 백엔드 대상. DB에 아무것도 안 씀(오염 없음).
//
// 이 하니스가 지키는 핵심 불변식:
//   ① transcribe 는 무료 플랜 AI 답변 캡(300건)을 "차감하지 않는다".
//      엣지 라우팅은 `isAnswer = !denylist.includes(task)` 구조라 denylist 에 태스크명을
//      빠뜨리면 조용히 answer 취급 → 캡을 갉아먹고 handleAnswer 로 잘못 라우팅된다.
//      answer 1건은 카운터가 오르고 transcribe 는 안 오르는지를 같이 재서 실증한다.
//   ② 지원 포맷(WAV)만 받는다 — 브라우저 원본 컨테이너(webm/mp4)를 그대로 올리면 거절.
//   ③ 페이로드 하드캡(3MB) 초과 거절 — 비용 DoS 방어선.
//   ④ 무음/잡음뿐이면 empty=true (없는 말을 지어내지 않는다).
//
// 사용: QA_EMAIL=owner@pilot.squaretable.app QA_PASSWORD=pilot1234 node scripts/qa-transcribe.mjs
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

// ── 합성 WAV (16kHz 모노 16-bit PCM) — 클라(lib/voice/wav.ts)가 만드는 것과 같은 규격 ──
function makeWav(seconds, { hz = 0, amp = 0 } = {}) {
  const rate = 16000, n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = hz ? Math.sin((2 * Math.PI * hz * i) / rate) * amp : 0;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  return buf.toString('base64');
}

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

// 현재 KST 월의 AI 답변 사용량. RLS 읽기 정책(0062)으로 내 매장 행만 보인다.
async function usedNow(token) {
  const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const res = await fetch(`${URL_}/rest/v1/ai_usage_monthly?select=used&month=eq.${month}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? Number(rows[0].used ?? 0) : 0;
}

// 무료 모드/유료 플랜이면 카운터가 애초에 안 오른다 → 차감 비교가 무의미(SKIP 판정용).
async function quotaMeterLive(token) {
  const fm = await fetch(`${URL_}/rest/v1/rpc/billing_free_mode`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` }, body: '{}' });
  const freeMode = await fm.json().catch(() => null);
  if (freeMode !== false) return { live: false, why: 'billing_free_mode=true' };
  const sres = await fetch(`${URL_}/rest/v1/unit_subscriptions?select=plan`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  const rows = await sres.json().catch(() => []);
  const plan = Array.isArray(rows) && rows[0] ? (rows[0].plan ?? 'free') : 'free';
  return plan === 'free' ? { live: true } : { live: false, why: `plan=${plan}(무제한)` };
}

(async () => {
  const token = await signIn();
  console.log('\n[1] 인증·입력 검증');

  const noAuth = await call(null, 'transcribe', { mimeType: 'audio/wav', audioBase64: makeWav(1), durationMs: 1000 });
  chk(noAuth.status === 401, '미인증 호출 거부(401)', `status=${noAuth.status}`);

  const badMime = await call(token, 'transcribe', { mimeType: 'audio/webm', audioBase64: makeWav(1), durationMs: 1000 });
  chk(badMime.body?.error === 'unsupported_audio', '지원 안 하는 컨테이너(webm) 거절', JSON.stringify(badMime.body).slice(0, 120));

  // 3MB 초과 — 실제 오디오를 만들 필요 없이 base64 길이만 넘기면 된다(하드캡은 길이로 판정).
  const tooBig = await call(token, 'transcribe', { mimeType: 'audio/wav', audioBase64: 'A'.repeat(3_000_001), durationMs: 90_000 });
  chk(tooBig.body?.error === 'audio_too_large', '페이로드 하드캡(3MB) 초과 거절', JSON.stringify(tooBig.body).slice(0, 120));

  const emptyPayload = await call(token, 'transcribe', { mimeType: 'audio/wav', audioBase64: '', durationMs: 0 });
  chk(emptyPayload.body?.empty === true && !emptyPayload.body?.text, '빈 오디오 → empty=true(모델 호출 없음)');

  console.log('\n[2] 무음 전사 — 없는 말을 지어내지 않는가');
  await sleep(1200); // 분당 레이트리밋(사용자 10) 여유
  const silence = await call(token, 'transcribe', { mimeType: 'audio/wav', audioBase64: makeWav(2), durationMs: 2000 });
  chk(silence.ok, '무음 WAV 업스트림 수용(포맷 거절 없음)', `status=${silence.status} ${JSON.stringify(silence.body).slice(0, 160)}`);
  chk(silence.body?.empty === true && !silence.body?.text, '무음 → empty=true · text 비어 있음', JSON.stringify(silence.body).slice(0, 160));
  chk(silence.body?.usage == null, '무음은 모델 호출 전에 컷(usage 없음 = 비용 0)', JSON.stringify(silence.body?.usage).slice(0, 80));

  // 신호 세기는 충분하지만 사람 말이 아닌 경우(기계음). 무음 게이트를 통과해 모델까지 가므로
  // "말이 아니면 비운다"는 모델 쪽 규칙이 실제로 지켜지는지 본다.
  await sleep(1200);
  const tone = await call(token, 'transcribe', { mimeType: 'audio/wav', audioBase64: makeWav(2, { hz: 440, amp: 0.3 }), durationMs: 2000 });
  chk(tone.body?.empty === true && !tone.body?.text, '사람 말이 아닌 톤 → empty=true(지어내지 않음)', JSON.stringify(tone.body).slice(0, 160));

  console.log('\n[3] 실제 한국어 발화 전사 — 있는 말은 제대로 받아쓰는가');
  // 합성 음성 픽스처. 없으면 SKIP — 없는 말을 안 지어내는 것만 보고 "잘 받아쓴다"고
  // 착각하지 않도록 대조군을 명시적으로 남긴다. (앱 번들에 실리지 않게 assets/ 밖에 둔다.)
  // 다시 만드는 법(Windows · ko-KR 음성 필요):
  //   powershell -c "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer;
  //   $s.SelectVoice('Microsoft Heami Desktop');
  //   $f=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,'Sixteen','Mono');
  //   $s.SetOutputToWaveFile('scripts/fixtures/speech_ko.wav',$f); $s.Speak('<아래 기대 문장>'); $s.Dispose()"
  let speechWav = null;
  try { speechWav = readFileSync(here('./fixtures/speech_ko.wav')); } catch {}
  if (!speechWav) {
    note('발화 픽스처(scripts/fixtures/speech_ko.wav) 없음', '스크립트 상단 주석의 생성 명령 참고');
  } else {
    await sleep(1200);
    const spoken = await call(token, 'transcribe', { mimeType: 'audio/wav', audioBase64: speechWav.toString('base64'), durationMs: Math.round(((speechWav.length - 44) / 32000) * 1000) });
    const text = String(spoken.body?.text ?? '');
    chk(spoken.body?.empty === false && text.length > 10, '발화 → 텍스트가 나온다', JSON.stringify(spoken.body).slice(0, 160));
    // 픽스처 문장의 핵심 단어가 살아있는지(요약·의역으로 뭉개지지 않았는지).
    for (const w of ['그라인더', '물청소', '행주', '냉장고']) {
      chk(text.includes(w), `핵심어 보존: ${w}`, text.slice(0, 80));
    }
  }

  console.log('\n[4] ★ 쿼터 미차감 — transcribe 는 AI 답변 캡을 갉지 않는다');
  const meter = await quotaMeterLive(token);
  if (!meter.live) {
    note('쿼터 카운터 비활성 계정이라 차감 비교 불가', meter.why);
  } else {
    const before = await usedNow(token);
    await sleep(1200);
    await call(token, 'transcribe', { mimeType: 'audio/wav', audioBase64: makeWav(1, { hz: 440, amp: 0.2 }), durationMs: 1000 });
    await sleep(800);
    const afterT = await usedNow(token);
    chk(afterT === before, 'transcribe 후 used 불변', `${before} → ${afterT}`);

    // 대조군 — 같은 계정의 answer 1건은 실제로 카운터를 올린다(=계측이 살아 있다는 증거).
    // 이게 없으면 "그냥 카운터가 죽어 있어서 안 오른 것"과 구분이 안 된다.
    await sleep(1200);
    await call(token, 'answer', {
      query: '마감 청소 어떻게 해요?',
      sops: [{ id: 'sop_qa_t', title: '마감 청소', category: 'Routine', situation: '영업 마감 후', steps: ['바닥을 청소한다'], donts: [], creatorName: '사장님', version: 1, updatedAt: '2026-07-01T00:00:00Z' }],
    });
    await sleep(800);
    const afterA = await usedNow(token);
    chk(afterA === afterT + 1, '대조군: answer 1건은 used +1 (카운터 살아있음)', `${afterT} → ${afterA}`);
  }

  console.log(`\n결과: PASS ${pass} · FAIL ${fail}${skip ? ` · SKIP ${skip}` : ''}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('하니스 오류:', e); process.exit(1); });
