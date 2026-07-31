#!/usr/bin/env node
// qa-join-reject-browser.mjs — 합류 거절 감지(#미아 방지) 브라우저 E2E.
//
// 서버 reject_member 는 신청자에게 아무 신호가 없다 → 기기 마커(joinRejectDetect.ts)로 감지해
// junior/hub 에 "승인되지 않았어요" 카드를 띄우는 체인을 실 백엔드 + 실 브라우저로 실증한다.
//   T1 대기: 신청 직원 로그인 → 대기 카드("사장님 승인 대기 중")
//   T2 거절: 사장이 reject_member → '승인 확인' 클릭 → 거절 안내 카드
//   T3 생존: 새로고침 후에도 카드 유지(닫기 전까지)
//   T4 닫기: '닫기' → 카드 소멸 → 새로고침에도 재등장 없음(마커 정리)
// 자가정리: 두 계정 delete_my_account + OTP 시드 정리.
//
// 실행: node scripts/qa-join-reject-browser.mjs  (.env + .env.seed + playwright, 앱은 QA_ORIGIN)
//   기본 QA_ORIGIN=http://localhost:8081 (expo web dev 서버가 떠 있어야 한다)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 없으면 skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치: npm i --no-save playwright && npx playwright install chromium'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

// supabase-js 웹 클라이언트가 세션을 복원하는 localStorage 키(sb-<ref>-auth-token)에
// 토큰 grant 응답을 그대로 심어 UI 로그인 없이 로그인 상태로 부팅한다.
const projectRef = new URL(URL_).hostname.split('.')[0];
async function passwordSession(email) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j;
}

async function main() {
  // ── 셋업(노드): 사장(매장) + 직원(합류 신청 pending) ──────────────
  const owner = mk(), junior = mk();
  const phoneO = `0107${s.slice(0, 7)}`, phoneJ = `0108${s.slice(0, 7)}`;
  await seedVerifiedPhones(URL_, SRV, [phoneO, phoneJ]);
  const oUp = await owner.auth.signUp({ email: `qa_jrb_o_${s}@example.com`, password: pw, options: { data: { name: 'QA거절사장', role: 'owner', phone: phoneO, birth_date: '1980-01-15' } } });
  if (oUp.error) throw new Error('owner signUp: ' + oUp.error.message);
  const jUp = await junior.auth.signUp({ email: `qa_jrb_j_${s}@example.com`, password: pw, options: { data: { name: 'QA거절직원', role: 'junior', phone: phoneJ, birth_date: '2000-05-05' } } });
  if (jUp.error) throw new Error('junior signUp: ' + jUp.error.message);
  const juniorId = jUp.data.user?.id;

  const { data: c1, error: e1 } = await owner.rpc('create_store', { p_store_name: 'QA거절카페', p_industry: '카페·디저트', p_biz_no: null });
  const storeRow = Array.isArray(c1) ? c1[0] : c1;
  if (e1 || !storeRow?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  const { data: j1, error: e2 } = await junior.rpc('join_by_invite', { p_code: storeRow.invite_code });
  const joinRow = Array.isArray(j1) ? j1[0] : j1;
  if (e2 || !joinRow?.unit_id) throw new Error('join_by_invite: ' + (e2?.message ?? 'no row'));

  // ── 브라우저: 신청 직원으로 부팅 ─────────────────────────────
  const session = await passwordSession(`qa_jrb_j_${s}@example.com`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 900 } });
  page.setDefaultTimeout(20000);
  await page.addInitScript(([key, val]) => localStorage.setItem(key, val), [`sb-${projectRef}-auth-token`, JSON.stringify(session)]);

  try {
    await page.goto(`${ORIGIN}/junior/hub`, { waitUntil: 'domcontentloaded' });
    const waitCard = page.getByText('사장님 승인 대기 중');
    await waitCard.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    check('T1 신청 직원 → 승인 대기 카드', await waitCard.isVisible().catch(() => false));

    // ── 사장이 거절 → '승인 확인'으로 즉시 재조회 ─────────────────
    const { error: rejErr } = await owner.rpc('reject_member', { p_uid: juniorId });
    check('T2a 사장 reject_member 성공', !rejErr, rejErr?.message ?? '');
    await page.getByText('승인 확인').dispatchEvent('click');
    const rejectCard = page.getByText('합류 신청이 승인되지 않았어요');
    await rejectCard.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check('T2b 거절 안내 카드 노출', await rejectCard.isVisible().catch(() => false));
    // 노드 RPC로 신청했으므로 이 기기 마커엔 매장 이름이 없다 → 폴백 표기를 검증
    // (이름 보존 경로는 qa:session 진리표 '거절 후 같은 매장 재신청 → 이름 보존' 케이스가 커버).
    check('T2c 안내 본문 + 이름 폴백', await page.getByText('코드를 다시 확인해').isVisible().catch(() => false)
      && await page.getByText('신청한 매장').first().isVisible().catch(() => false));

    // ── 새로고침 생존(마커) ──────────────────────────────────
    await page.reload({ waitUntil: 'domcontentloaded' });
    await rejectCard.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    check('T3 새로고침 후에도 안내 유지', await rejectCard.isVisible().catch(() => false));

    // ── 닫기 → 소멸 + 재등장 없음 ─────────────────────────────
    await page.getByText('닫기').dispatchEvent('click');
    await page.waitForTimeout(800);
    check('T4a 닫기 → 카드 소멸', !(await rejectCard.isVisible().catch(() => false)));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('매장 코드 입력').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    check('T4b 새로고침 후 재등장 없음(마커 정리)', !(await rejectCard.isVisible().catch(() => false)));
  } finally {
    await browser.close();
    // ── 자가정리 ───────────────────────────────────────────
    try { await junior.rpc('delete_my_account'); } catch { /* noop */ }
    try { await owner.rpc('delete_my_account'); } catch { /* noop */ }
    await cleanupSeededPhones(URL_, SRV, [phoneO, phoneJ]).catch(() => {});
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
