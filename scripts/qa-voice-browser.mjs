// 음성 입력 — 브라우저 쪽 체인 QA (Playwright 가짜 마이크).
// 엣지 하니스(qa-transcribe)는 이미 WAV 를 만들어 넣으므로, 아래 셋은 여기서만 잡힌다:
//   ① 브라우저가 만든 컨테이너(webm/opus)를 우리가 WAV 로 제대로 바꾸는가
//   ② 말이 끝나면 자동으로 멈추는가 (안 멈추면 60초 캡까지 녹음돼 침묵까지 업로드)
//   ③ 아무 말도 없을 때 업로드 없이 취소되는가
//
// ★함정: Chrome 의 --use-file-for-fake-audio-capture 는 **파일을 무한 반복 재생**한다.
//   무음 구간이 없는 픽스처를 쓰면 자동 종료가 영영 안 걸려 테스트가 통과하지 못한다.
//   → 발화 픽스처 뒤에 무음을 덧붙인 임시 파일을 만들어 쓴다(아래 makeFixtures).
//
// 사용:
//   npm i --no-save playwright && npx playwright install chromium
//   QA_EMAIL=owner@pilot.squaretable.app QA_PASSWORD=pilot1234 node scripts/qa-voice-browser.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
function parseEnv(f) { const o = {}; try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch {} return o; }
const env = parseEnv(here('../.env'));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.QA_EMAIL, PASSWORD = process.env.QA_PASSWORD;
// 보안 출처(https)에서만 getUserMedia 가 동작한다 → 운영 도메인을 빈 페이지로 연다.
const ORIGIN = process.env.QA_ORIGIN ?? 'https://dochackchack.com';
if (!URL_ || !ANON) { console.error('env(.env) 누락'); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error('QA_EMAIL / QA_PASSWORD 필요'); process.exit(1); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치: npm i --no-save playwright && npx playwright install chromium'); process.exit(1); }

let pass = 0, fail = 0;
const chk = (c, n, d) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' → ' + d : ''}`); } };

// ── 픽스처: 발화 뒤 무음 6초 / 완전 무음 20초 ────────────────
function wavOf(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function makeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'voiceqa-'));
  const speech = readFileSync(here('./fixtures/speech_ko.wav')).subarray(44);
  const padded = join(dir, 'speech_pad.wav');
  const silent = join(dir, 'silence.wav');
  writeFileSync(padded, wavOf(Buffer.concat([speech, Buffer.alloc(16000 * 2 * 6)])));
  writeFileSync(silent, wavOf(Buffer.alloc(16000 * 2 * 20)));
  return { padded, silent };
}

// 앱 원본 wav.ts 를 브라우저에 주입한다(복붙본이 아니라 실제 코드 — 타입 표기만 걷어냄).
function loadWavSource() {
  return readFileSync(here('../src/lib/voice/wav.ts'), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export /gm, '')
    .replace(/: (Float32Array|AudioBuffer|number|string|Blob|Uint8Array)(\b|\[\])/g, '')
    .replace(/: Promise<\{[^}]*\}>/g, '')
    .replace(/\(globalThis as any\)/g, 'globalThis')
    .replace(/ as any/g, '');
}
// recorder.ts 의 자동종료 상수를 소스에서 직접 뽑는다 — 상수가 바뀌면 테스트도 같이 움직인다.
function autoStopConfig() {
  const src = readFileSync(here('../src/lib/voice/shared.ts'), 'utf8');
  const num = (name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9_.]+)`));
    if (!m) throw new Error(`shared.ts 에서 ${name} 을 못 찾음`);
    return Number(m[1].replace(/_/g, ''));
  };
  return {
    SILENCE_AFTER_SPEECH_MS: num('SILENCE_AFTER_SPEECH_MS'),
    NO_SPEECH_TIMEOUT_MS: num('NO_SPEECH_TIMEOUT_MS'),
    SPEECH_MIN_RMS: num('SPEECH_MIN_LEVEL'),
    SPEECH_OVER_FLOOR: num('SPEECH_OVER_FLOOR'),
    FLOOR_RISE: num('FLOOR_RISE'),
    LEVEL_POLL_MS: num('LEVEL_POLL_MS'),
  };
}

async function signIn() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function openPage(audioFile) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${audioFile}`,
    ],
  });
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message));
  await page.goto(ORIGIN);
  return { browser, page };
}

// 브라우저 안에서 돌 실제 로직 — recorder.ts startLevelMonitor 과 같은 판정식.
async function record(page, cfg, extra) {
  return page.evaluate(async ({ cfg, extra }) => {
    const t0 = Date.now();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let stoppedResolve; const stopped = new Promise((r) => { stoppedResolve = r; });
    rec.onstop = () => stoppedResolve();
    rec.start();

    const actx = new AudioContext();
    await actx.resume?.();
    const an = actx.createAnalyser(); an.fftSize = 1024;
    actx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    let floor = Infinity, saw = false, lastLoud = Date.now(), reason = null, speechEndAt = 0;
    await new Promise((done) => {
      const iv = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        const rms = Math.sqrt(s / buf.length);
        floor = rms < floor ? rms : Math.min(floor * cfg.FLOOR_RISE, rms);
        const th = Math.max(cfg.SPEECH_MIN_RMS, floor * cfg.SPEECH_OVER_FLOOR);
        const now = Date.now();
        if (rms > th) { saw = true; lastLoud = now; return; }
        if (!saw && now - t0 > cfg.NO_SPEECH_TIMEOUT_MS) { reason = 'no_speech'; clearInterval(iv); done(); return; }
        if (saw && now - lastLoud > cfg.SILENCE_AFTER_SPEECH_MS) { reason = 'silence'; speechEndAt = lastLoud; clearInterval(iv); done(); return; }
        // 최대길이 캡보다 먼저 테스트를 끝낸다(캡까지 갔다면 자동종료 실패로 판정).
        if (now - t0 > extra.giveUpMs) { reason = 'gave_up'; clearInterval(iv); done(); }
      }, cfg.LEVEL_POLL_MS);
    });
    const stopAt = Date.now();

    // ★ state 가 아니라 onstop 을 기다린다 — stop() 직후엔 마지막 chunk 가 아직 안 왔다.
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: rec.mimeType });
    stream.getTracks().forEach((t) => t.stop());
    actx.close();
    return { reason, stopMs: stopAt - t0, speechEndMs: speechEndAt ? speechEndAt - t0 : 0, blobBytes: blob.size, chunks: chunks.length };
  }, { cfg, extra });
}

(async () => {
  const cfg = autoStopConfig();
  const { padded, silent } = makeFixtures();
  const token = await signIn();
  const wavJs = loadWavSource();
  console.log(`\n설정: 무음 ${cfg.SILENCE_AFTER_SPEECH_MS}ms 후 종료 · 무발화 ${cfg.NO_SPEECH_TIMEOUT_MS}ms 후 취소`);

  console.log('\n[1] 말이 끝나면 자동 종료 + 전사까지');
  {
    const { browser, page } = await openPage(padded);
    const r = await record(page, cfg, { giveUpMs: 40_000 });
    chk(r.reason === 'silence', '무음 감지로 자동 종료(60초 캡까지 안 감)', `reason=${r.reason} stop=${(r.stopMs / 1000).toFixed(1)}초`);
    chk(r.chunks > 0 && r.blobBytes > 0, '★ 정지 직후에도 오디오가 비지 않음(onstop 대기)', `chunks=${r.chunks} bytes=${r.blobBytes}`);
    const lag = r.stopMs - r.speechEndMs;
    chk(lag >= cfg.SILENCE_AFTER_SPEECH_MS && lag < cfg.SILENCE_AFTER_SPEECH_MS + 1500, '말 끝난 뒤 대기시간이 설정값과 일치', `${(lag / 1000).toFixed(1)}초`);

    // 같은 페이지에서 실제 wav.ts 로 변환 → 엣지 전사까지
    const t = await page.evaluate(async ({ wavJs, url, anon, token, file }) => {
      eval(wavJs);
      const res = await fetch(file); const blob = await res.blob();
      const { base64, durationMs } = await blobToWavBase64(blob);
      const r = await fetch(`${url}/functions/v1/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` }, body: JSON.stringify({ task: 'transcribe', payload: { mimeType: 'audio/wav', audioBase64: base64, durationMs } }) });
      return { status: r.status, body: await r.json(), b64Len: base64.length };
    }, { wavJs, url: URL_, anon: ANON, token, file: `data:audio/wav;base64,${readFileSync(padded).toString('base64')}` });
    const text = String(t.body?.text ?? '');
    chk(t.status === 200 && text.length > 10, '실제 wav.ts 변환 → 엣지 전사 성공', `${t.status} ${JSON.stringify(t.body).slice(0, 120)}`);
    for (const w of ['그라인더', '물청소', '행주']) chk(text.includes(w), `핵심어 보존: ${w}`, text.slice(0, 60));
    await browser.close();
  }

  console.log('\n[2] 아무 말도 없으면 업로드 없이 취소');
  {
    const { browser, page } = await openPage(silent);
    const r = await record(page, cfg, { giveUpMs: 25_000 });
    chk(r.reason === 'no_speech', '무발화 감지로 취소', `reason=${r.reason} stop=${(r.stopMs / 1000).toFixed(1)}초`);
    chk(r.stopMs < cfg.NO_SPEECH_TIMEOUT_MS + 2000, '설정한 시간 안에 취소', `${(r.stopMs / 1000).toFixed(1)}초`);
    await browser.close();
  }

  console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('하니스 오류:', e); process.exit(1); });
