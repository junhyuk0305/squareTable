#!/usr/bin/env node
// qa-photo-private.mjs — 사진 버킷 비공개(0052) 크로스테넌트 읽기 차단 실증 (적용 전/후)
//
// 적용 전(현재 공개버킷): 공개URL 열림 + B가 A사진 서명 가능 → 🔴 구멍 확인
// 적용 후(0052):          공개URL 403 + B가 A사진 서명 거부 + A 본인은 서명·조회 정상 → ✅
//
// 실행: node --env-file=.env.seed scripts/qa-photo-private.mjs   (자가정리)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const env = { ...process.env };
for (const f of ['.env', '.env.seed']) { try { for (const l of readFileSync(f, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !env[m[1]]) env[m[1]] = m[2].trim(); } } catch {} }
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON) { console.error('env 없음'); process.exit(2); }
const BUCKET = 'playbook-photos';
const rid = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m} ${x}`); c ? pass++ : fail++; };
// 1x1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'), c => c.charCodeAt(0));

const seededPhones = []; // 0088 게이트 라이브 — 번호를 '인증됨'으로 선등록해야 create_store 통과
async function owner(tag) {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const ph = '010' + String(Math.floor(1e7 + Math.random() * 8e7));
  await seedVerifiedPhones(URL, SRV, [ph]);
  seededPhones.push(ph);
  const { data: su, error: se } = await c.auth.signUp({ email: `ph_${tag}_${rid}@example.com`, password: 'Test!2345', options: { data: { name: `PH_${tag}`, role: 'owner', phone: ph, phone_last4: ph.slice(-4), birth_date: '1990-01-15' } } });
  if (se || !su.session) throw new Error(`${tag} signUp ${se?.message}`);
  const { data: cs, error: ce } = await c.rpc('create_store', { p_store_name: `PH_${tag}_${rid}`, p_industry: '카페·디저트', p_biz_no: null });
  if (ce) throw new Error(`${tag} create_store ${ce.message}`);
  return { c, uid: su.user.id, unit: (Array.isArray(cs) ? cs[0] : cs)?.unit_id };
}

(async () => {
  console.log('· 사진 비공개 실증:', URL, '\n');
  const A = await owner('A'), B = await owner('B');

  // A가 본인 매장 폴더에 업로드
  const path = `${A.unit}/${Date.now()}-${rid}.png`;
  const up = await A.c.storage.from(BUCKET).upload(path, PNG, { contentType: 'image/png', upsert: false });
  ok(!up.error, 'A 본인 폴더 업로드 성공', up.error ? `(${up.error.message.slice(0, 50)})` : path.slice(0, 30));

  // 1) A 본인 서명URL 발급 + 조회 200 (정상 동작 보존)
  const sA = await A.c.storage.from(BUCKET).createSignedUrl(path, 60);
  let aFetch = 0; if (sA.data?.signedUrl) aFetch = (await fetch(sA.data.signedUrl)).status;
  ok(!sA.error && aFetch === 200, 'A 본인 사진 서명URL 발급·조회 200', sA.error ? `(${sA.error.message.slice(0, 40)})` : `status=${aFetch}`);

  // 2) 공개 URL 직접 접근 — 0052 적용 후엔 열리면 안 됨(현재는 열림=구멍)
  const pub = A.c.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const pubStatus = (await fetch(pub)).status;
  ok(pubStatus !== 200, '공개URL 비로그인 접근 차단(403/400)', `status=${pubStatus}${pubStatus === 200 ? '  🔴 아직 공개(0052 미적용)' : ''}`);

  // 3) ★크로스테넌트: B가 A 사진 경로로 서명URL 발급 시도 — 0052 적용 후엔 거부
  const sB = await B.c.storage.from(BUCKET).createSignedUrl(path, 60);
  let bFetch = 0; if (sB.data?.signedUrl) bFetch = (await fetch(sB.data.signedUrl)).status;
  const bBlocked = !!sB.error || bFetch !== 200;
  ok(bBlocked, '★B가 A사진 서명URL 발급 차단(크로스테넌트)', sB.error ? `(거부 ${sB.error.message.slice(0, 30)})` : `status=${bFetch}${bFetch === 200 ? '  🔴 아직 열림(0052 미적용)' : ''}`);

  // 정리
  await A.c.storage.from(BUCKET).remove([path]).catch(() => {});
  for (const o of [A, B]) { try { await o.c.rpc('delete_my_account'); } catch {} }
  if (SRV) {
    const admin = createClient(URL, SRV, { auth: { persistSession: false } });
    await admin.from('units').delete().like('store_name', 'PH_%');
    let p = 1; for (;;) { const res = await fetch(`${URL}/auth/v1/admin/users?page=${p}&per_page=200`, { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } }); const j = await res.json(); const us = j.users || []; for (const u of us) if ((u.email || '').startsWith('ph_')) await fetch(`${URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } }); if (us.length < 200) break; p++; }
  }
  await cleanupSeededPhones(URL, SRV, seededPhones);
  console.log(`\nRESULT: ${pass} passed, ${fail} failed${fail ? '  (0052 미적용 상태면 2·3번 FAIL = 구멍 실증)' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('✗', e.message); process.exit(2); });
