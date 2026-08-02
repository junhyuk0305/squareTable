// PDF 올리기 — 브라우저 쪽 체인 QA (Playwright, 실 엣지 대상).
// 엣지 하니스(qa:import-pdf)는 doc_extract 를 직접 부르므로, 아래는 여기서만 잡힌다:
//   ① "PDF 올리기" 버튼 → 파일 선택창 → 추출 → **입력창 주입**이 실제 브라우저에서 이어지는가
//   ② 두 번 올리면 기존 내용 뒤에 "이어붙는가"(나눠 올리기)
//   ③ 10MB 초과를 클라가 업로드 전에 거절하는가(엣지까지 안 감)
//   ④ 읽을 게 없는 PDF(빈 페이지) → 지어내지 않고 안내 에러가 뜨는가
// DB 에는 아무것도 안 씀(주입까지만 — 파이프 실행은 안 눌러 draft 오염 없음).
//
// 사용: 앱은 QA_ORIGIN(기본 http://localhost:8081)에 떠 있어야 한다.
//   QA_EMAIL=owner@pilot.squaretable.app QA_PASSWORD=pilot1234 node scripts/qa-import-pdf-browser.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
function parseEnv(f) { const o = {}; try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch {} return o; }
const env = parseEnv(here('../.env'));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.QA_EMAIL, PASSWORD = process.env.QA_PASSWORD;
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
const SHOTS = process.env.QA_SHOTS_DIR ?? null; // 스크린샷 저장 폴더(옵션)
if (!URL_ || !ANON) { console.error('env(.env) 누락'); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error('QA_EMAIL / QA_PASSWORD 필요'); process.exit(1); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치: npm i --no-save playwright && npx playwright install chromium'); process.exit(1); }

let pass = 0, fail = 0;
const chk = (c, n, d) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' → ' + d : ''}`); } };

// ── 픽스처 ───────────────────────────────────────────────────
// 스캔·텍스트 PDF 는 엣지 QA 와 공유(make-doc-fixtures.mjs). 초과분·빈 페이지는 즉석 생성.
function makeExtraFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'pdfqa-'));
  const oversize = join(dir, 'oversize.pdf');
  // 클라 캡은 file.size 로만 판정 → 내용은 아무거나. 10MB+1 로 경계 바로 위를 찌른다.
  writeFileSync(oversize, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024)]));
  // 빈 페이지 PDF(콘텐츠 스트림 없음) — "읽을 게 없다" 경로.
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n',
  ];
  let out = '%PDF-1.4\n'; const offs = [0];
  for (const o of objs) { offs.push(out.length); out += o; }
  const xrefAt = out.length;
  out += `xref\n0 4\n0000000000 65535 f \n${offs.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const blank = join(dir, 'blank.pdf');
  writeFileSync(blank, Buffer.from(out, 'latin1'));
  return { oversize, blank };
}

const projectRef = new URL(URL_).hostname.split('.')[0];
async function passwordSession() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j;
}

// "PDF 올리기" 버튼을 눌러 파일 선택창에 filePath 를 넣는다(RNW Pressable = dispatchEvent click).
async function uploadPdf(page, filePath) {
  const btn = page.getByRole('button', { name: 'PDF 올리기' });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    btn.dispatchEvent('click'),
  ]);
  await chooser.setFiles(filePath);
}

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name), fullPage: true }).catch(() => {}); };

(async () => {
  const { oversize, blank } = makeExtraFixtures();
  const session = await passwordSession();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 900 } });
  page.setDefaultTimeout(20000);
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 200)}`); });
  await page.addInitScript(([key, val]) => localStorage.setItem(key, val), [`sb-${projectRef}-auth-token`, JSON.stringify(session)]);

  // 딥링크 직후 앱 부팅 리다이렉트(세션 복원 전 게이트)가 뒤늦게 화면을 스플래시로 덮는다
  // — 버튼이 보인 뒤에도 3초 정착을 확인하고, 덮였으면 재진입한다(실측: 1차 시도에서 재현).
  async function gotoHandover() {
    for (let i = 0; i < 3; i++) {
      await page.goto(`${ORIGIN}/owner/handover`, { waitUntil: 'domcontentloaded' });
      // 이전 세션 잔여 draft 가 있으면 검수 화면으로 부팅된다 → 입력 화면으로 이동.
      const moreLink = page.getByRole('button', { name: '인수인계서 더 올리기' });
      if (await moreLink.isVisible({ timeout: 4000 }).catch(() => false)) await moreLink.dispatchEvent('click');
      const btn = page.getByRole('button', { name: 'PDF 올리기' });
      const seen = await btn.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
      if (!seen) continue;
      await page.waitForTimeout(3000);
      if (await btn.isVisible().catch(() => false)) return;
    }
    throw new Error('handover 입력 화면 정착 실패(부팅 리다이렉트)');
  }

  try {
    console.log('\n[T1] 스캔 PDF → 추출 → 입력창 주입');
    await gotoHandover();
    chk(true, '입력 화면에 "PDF 올리기" 버튼 노출(정착 확인)');

    const input = page.locator('textarea').first();
    const before = await input.inputValue();

    // 추출 완료 판정은 로딩 라벨 소멸이 아니라 "입력창 값 변화"로 잰다 — 라벨은 렌더 타이밍에
    // 따라 등장 전에 hidden 판정이 나는 레이스가 있다(1차 실행에서 실증).
    const waitValueChange = async (prev, timeout = 90000) => {
      const t0 = Date.now();
      let v = prev;
      while (Date.now() - t0 < timeout) {
        v = await input.inputValue();
        if (v !== prev) return v;
        await page.waitForTimeout(500);
      }
      return v;
    };

    await uploadPdf(page, here('./fixtures/qa-doc-scan.pdf'));
    const busy = page.getByText('PDF에서 글자를 읽는 중');
    chk(await busy.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false), '추출 중 로딩 문구 표시');
    const v1 = await waitValueChange(before);
    chk(v1.length > before.length + 20, '입력창에 텍스트 주입됨', `len ${before.length}→${v1.length}`);
    for (const w of ['머신', '그라인더']) chk(v1.includes(w), `핵심어 보존: ${w}`, v1.slice(0, 120));
    await shot(page, 't1-injected.png');

    console.log('\n[T2] 두 번째 PDF → 기존 내용 뒤에 이어붙음(나눠 올리기)');
    await uploadPdf(page, here('./fixtures/qa-doc-text.pdf'));
    const v2 = await waitValueChange(v1);
    chk(v2.startsWith(v1.trimEnd()), '기존 내용 보존(앞부분 동일)', v2.slice(0, 80));
    chk(v2.toLowerCase().includes('preheat'), '새 내용이 뒤에 추가됨', v2.slice(-120));
    await shot(page, 't2-appended.png');

    console.log('\n[T3] 10MB 초과 → 업로드 전 거절');
    let edgeCalled = false;
    page.on('request', (r) => { if (r.url().includes('/functions/v1/ai')) edgeCalled = true; });
    await uploadPdf(page, oversize);
    const sizeErr = page.getByText('PDF가 너무 커요');
    chk(await sizeErr.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false), '크기 초과 에러 문구 노출');
    chk(!edgeCalled, '엣지 호출 없음(클라에서 컷)');
    chk((await input.inputValue()) === v2, '입력창 내용 불변');
    await shot(page, 't3-oversize.png');

    console.log('\n[T4] 빈 페이지 PDF → 지어내지 않고 안내 에러');
    await uploadPdf(page, blank);
    const emptyErr = page.getByText('글자를 읽지 못했어요');
    chk(await emptyErr.waitFor({ state: 'visible', timeout: 90000 }).then(() => true).catch(() => false), '읽기 실패 안내 에러 노출');
    chk((await input.inputValue()) === v2, '입력창 내용 불변(지어낸 텍스트 주입 없음)');
    await shot(page, 't4-blank.png');

    // 파이프 실행(CTA)은 누르지 않는다 — 실 계정에 draft 가 쌓인다(오염). 파이프 자체는 기존 기능
    // 커버리지(qa:split·qa:draft)가 담당.
    if (consoleErrors.length) console.log(`\n  [참고] 콘솔 에러 ${consoleErrors.length}건:\n    ` + consoleErrors.slice(0, 5).join('\n    '));
  } finally {
    await browser.close();
  }

  console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('하니스 오류:', e); process.exit(1); });
