// 진단(읽기 전용): 최근 client_errors — "일부 정보를 불러오지 못했어요" 배너의 실제 원인 추적용.
// 사용: node scripts/diag-client-errors.mjs [hours=48] --allow-remote   (라이브 조회는 --allow-remote 필요)
import './lib/require-local-target.mjs'; // 접속 대상 가드 — 로컬이 아니면 --allow-remote 없이 멈춘다
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.seed', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const db = createClient(url, key);

const hours = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) || 48);
const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
const { data, error } = await db
  .from('client_errors')
  .select('*')
  .gte('created_at', since)
  .order('created_at', { ascending: false })
  .limit(60);
if (error) {
  console.error('query failed:', error.message);
  process.exit(1);
}
console.log(`client_errors last ${hours}h: ${data.length} rows`);
for (const r of data) {
  const cols = Object.entries(r)
    .filter(([k]) => !['id'].includes(k))
    .map(([k, v]) => `${k}=${String(v ?? '').slice(0, 140)}`)
    .join(' | ');
  console.log(cols);
}
