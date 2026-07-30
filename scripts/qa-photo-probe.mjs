// qa-photo-probe.mjs — 실 백엔드에서 '사장이 사진 업로드' 경로를 그대로 재현.
// 임시 사장 계정+매장 생성 → 인증 세션으로 playbook-photos 업로드 시도 → 실제 에러 출력 → 계정 삭제.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  // .env.seed 는 phone_otps 인증 시드용 service_role 키 확보 목적(없으면 시드 스킵 — 게이트 미적용 환경).
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 파일 없음 */ }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY; // 있으면 phone_otps 시드(게이트 0088 대비)
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
// 200바이트짜리 유효 webp 흉내(실제 인코딩 아님 — RLS/스토리지 정책 검증엔 바이트 내용 무관)
const buf = Buffer.from('UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=', 'base64');

const owner = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
// 0088 게이트 라이브 — signUp 번호를 '인증됨'으로 선등록해야 create_store 통과.
const qaPhones = [`0108${s.slice(0, 7)}`];
try {
  await seedVerifiedPhones(URL, SERVICE, qaPhones);
  const { data: up, error: upErr } = await owner.auth.signUp({
    email: `qa_photo_${s}@example.com`, password: pw,
    options: { data: { name: 'QA사진사장', role: 'owner', phone: `0108${s.slice(0,7)}`, store_name: 'QA사진매장', industry: '카페·디저트', birth_date: '1990-01-15' } },
  });
  if (upErr || !up?.session) throw new Error('signUp 실패: ' + (upErr?.message ?? 'no session'));
  await owner.auth.setSession({ access_token: up.session.access_token, refresh_token: up.session.refresh_token });

  const { data: cs, error: csErr } = await owner.rpc('create_store', { p_store_name: 'QA사진매장', p_industry: '카페·디저트', p_biz_no: null });
  if (csErr) throw new Error('create_store 실패: ' + csErr.message);
  const row = Array.isArray(cs) ? cs[0] : cs;
  const unit = row?.unit_id;
  console.log('사장 unit_id =', unit);

  // 0) auth_unit_id() 가 실제로 무엇을 반환하는지 (RLS가 이 값과 경로 첫 폴더를 비교)
  const { data: aui, error: auiErr } = await owner.rpc('auth_unit_id');
  console.log('auth_unit_id() RPC =', auiErr ? ('ERR: ' + auiErr.message) : JSON.stringify(aui), '| 경로첫폴더와 일치?', String(aui) === String(unit));

  async function tryUpload(label, ext, opts) {
    const path = `${unit}/${Date.now()}-${Math.round(Math.random()*1e6)}.${ext}`;
    const { data, error } = await owner.storage.from('playbook-photos').upload(path, buf, opts);
    console.log(`\n[${label}] path=${path}`);
    console.log(`  opts=${JSON.stringify(opts)}`);
    console.log('  =>', error ? `❌ ${error.message} (status=${error.statusCode||error.status||'?'} name=${error.name||'?'})` : `✅ OK key=${data?.path}`);
    return !error;
  }

  // A) 내 db.ts 와 100% 동일: webp + cacheControl 1년
  await tryUpload('A webp+cacheControl(현재 코드)', 'webp', { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  // B) cacheControl 없이 webp (cacheControl 이 원인인지 격리)
  await tryUpload('B webp, no cacheControl', 'webp', { contentType: 'image/webp', upsert: false });
  // C) jpg (확장자 화이트리스트/webp 문제 격리 — 기존 task-cert 방식)
  await tryUpload('C jpg (기존 방식)', 'jpg', { contentType: 'image/jpeg', upsert: false });
  // D) 잘못된 폴더(타 매장) — RLS가 진짜 살아있는지 대조군
  {
    const path = `someone_else_unit/${Date.now()}.webp`;
    const { error } = await owner.storage.from('playbook-photos').upload(path, buf, { contentType: 'image/webp' });
    console.log(`\n[D 대조군: 타매장폴더] => ${error ? '차단됨(정상): ' + error.message : '⚠️ 통과됨(RLS 구멍!)'}`);
  }
} catch (e) {
  console.log('PROBE ERROR:', e.message);
} finally {
  try { await owner.rpc('delete_my_account'); console.log('\n(정리) 테스트 계정 삭제'); } catch (e) { console.log('cleanup 실패:', e.message); }
  await cleanupSeededPhones(URL, SERVICE, qaPhones);
}
