#!/usr/bin/env node
// create-toss-reviewer.mjs — 토스페이먼츠·카드사 심사관용 사장 계정 1개 + 무료 매장 1곳 만들기(1회).
//
//   심사 FAQ: "비회원 구매 불가면 테스트 계정(ID/PW) 필수 · 소셜 로그인 계정 불가". 가입은 휴대폰 SMS 인증이 필요해
//   심사관이 직접 못 만든다 → 이메일+비밀번호 계정을 미리 만들어 회신에 적는다.
//   QA 고정 계정(owner@pilot 등)과 분리한 이유 = qa:seed 가 데이터를 되돌려도 심사 화면이 흔들리지 않게(2026-09-15 사용자 결정).
//
// ⛔ 라이브 DB 에 쓴다. iOS 심사 중에는 실행하지 않는다. 기본은 계획만 출력(dry run), --execute 에서만 만든다.
// 실행: node scripts/create-toss-reviewer.mjs --execute [--email toss.review@dochackchack.com]
// 뒤처리: 출력된 이메일을 엣지 시크릿 TOSS_TEST_OWNER_EMAILS 에 넣는다(테스트 키 기간에 이 계정만 카드 결제가 열린다).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* */ }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) { console.error('FAIL: URL·ANON·SERVICE 키 필요(.env / .env.seed)'); process.exit(2); }

const args = process.argv.slice(2);
const email = (args[args.indexOf('--email') + 1] && args.includes('--email')) ? args[args.indexOf('--email') + 1] : 'toss.review@dochackchack.com';
const execute = args.includes('--execute');
// 영문·숫자만(심사관이 옮겨 적기 쉽게). 12자.
const password = 'Tr' + randomBytes(8).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) + '26';
// 심사용 더미 번호(실사용 번호와 겹치지 않게 0100000 대역). 문자는 발송하지 않는다.
const phone = '0100000' + String(Math.floor(1000 + Math.random() * 9000));

console.log({ email, phone, 매장: '매장의정석 심사용 매장(카페)' });
if (!execute) { console.log('(dry run) 만들려면 --execute'); process.exit(0); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

const { data: created, error: ce } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
  user_metadata: { name: '토스심사', role: 'owner', phone, birth_date: '1990-01-01' },
});
if (ce) { console.error('FAIL: 계정 생성 —', ce.message); process.exit(1); }

// 매장 개설은 전화 인증 게이트(0088)를 통과해야 한다 — service_role 로 인증됨 행을 넣고, 개설 후 지운다.
const now = new Date().toISOString();
await fetch(`${URL}/rest/v1/phone_otps`, {
  method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify([{ phone, code_hash: 'qa-seed', expires_at: now, verified_at: now }]),
});

const user = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: se } = await user.auth.signInWithPassword({ email, password });
if (se) { console.error('FAIL: 로그인 —', se.message); process.exit(1); }
const { data: store, error: ste } = await user.rpc('create_store', { p_store_name: '매장의정석 심사용 매장', p_industry: '카페·디저트', p_biz_no: null });
await fetch(`${URL}/rest/v1/phone_otps?phone=eq.${phone}&code_hash=eq.qa-seed`, { method: 'DELETE', headers: H });
if (ste) { console.error('FAIL: 매장 개설 —', ste.message); process.exit(1); }

console.log('\nOK — 회신·PPT 표지에 아래 값을 적는다(비밀번호는 여기서 한 번만 보인다).');
console.log(`  ID: ${email}\n  PW: ${password}\n  user_id: ${created.user.id}\n  매장: ${store?.[0]?.unit_id}`);
console.log(`\n다음: supabase secrets set TOSS_TEST_OWNER_EMAILS=${email}`);
