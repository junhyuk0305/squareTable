// fetch-dashboard-data.mjs — 실 Supabase → 내부 운영 대시보드용 로컬 스냅샷 생성기
//
// 왜 이렇게: KPI 뷰/집계는 테넌트 경계를 넘으므로 service_role 로만 조회해야 한다(0021 주석 참조).
//   service_role 키를 HTML(브라우저)에 박으면 곧 유출이므로, 이 Node 스크립트가 서버측에서
//   키를 써서 데이터를 뽑아 `운영_대시보드_data.js`(window.DASHBOARD_DATA)로 떨어뜨린다.
//   HTML 은 그 로컬 파일만 읽는다 → 키는 이미 gitignore 된 .env.seed 밖으로 안 나감.
//
// 실행:  cd SquareTable
//        node --env-file=.env.seed scripts/fetch-dashboard-data.mjs
//   (.env.seed 에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 존재 — 이미 있음/gitignore됨)
//
// 출력:  ../운영_대시보드_data.js   (대시보드 HTML 옆, 역시 로컬 전용)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', '..', '운영_대시보드_data.js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다. `node --env-file=.env.seed ...` 로 실행하세요.');
  process.exit(1);
}

const CATS = ['Routine', 'Event', 'Context', 'Know-how'];
const N_WEEKS = 8;

// ── PostgREST 페이지네이션 조회 (service_role = RLS 우회, 전 매장) ──
async function fetchAll(table, query) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const to = from + page - 1;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${to}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${table} 조회 실패 ${res.status}: ${body.slice(0, 300)}`);
    }
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

// ── KST 주(월요일) 버킷 ──
function kstMonday(iso) {
  const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const diff = (kst.getUTCDay() + 6) % 7; // 월=0
  kst.setUTCDate(kst.getUTCDate() - diff);
  kst.setUTCHours(0, 0, 0, 0);
  return kst;
}
const weekKey = (d) => d.toISOString().slice(0, 10);
const weekLabel = (d) => `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')}`;

function lastNWeekKeys(now, n) {
  const cur = kstMonday(now.toISOString());
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(cur);
    d.setUTCDate(d.getUTCDate() - i * 7);
    keys.push({ key: weekKey(d), label: weekLabel(d) });
  }
  return keys;
}

function agoKo(iso, now) {
  const days = Math.floor((now - new Date(iso)) / 86400000);
  if (days <= 0) return '오늘';
  if (days === 1) return '1일 전';
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

// KST(UTC+9) 기준 YYYY.MM.DD
function kstDateStr(iso) {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
}

(async () => {
  console.log('· Supabase 연결:', SUPABASE_URL);
  const [units, profiles, entries, chats, unknowns] = await Promise.all([
    fetchAll('units', 'select=id,store_name,industry,subcategory,created_at&order=created_at.asc'),
    fetchAll('profiles', 'select=id,unit_id,role,name,phone,phone_last4,created_at,deleted_at&order=created_at.asc'),
    fetchAll('playbook_entries', 'select=id,unit_id,category,subcategory,title,stats,version,status'),
    fetchAll('chat_queries', 'select=unit_id,junior_id,asked_at,matched_entry_ids,satisfaction'),
    fetchAll('unknown_queries', 'select=unit_id,query_text,presumed_category,presumed_subcategory,junior_name,similar_queries_count,status,asked_at'),
  ]);
  console.log(`· 수신: units ${units.length} · profiles ${profiles.length} · entries ${entries.length} · chat_queries ${chats.length} · unknown_queries ${unknowns.length}`);

  const now = new Date();
  const weekDefs = lastNWeekKeys(now, N_WEEKS);
  const keyIndex = new Map(weekDefs.map((w, i) => [w.key, i]));

  const stores = units.map((u, idx) => {
    const juniors = profiles.filter((p) => p.unit_id === u.id && p.role === 'junior').length;

    const myEntries = entries
      .filter((e) => e.unit_id === u.id && (e.status === 'published' || !e.status))
      .map((e) => {
        const s = e.stats || {};
        return {
          title: e.title,
          cat: CATS.includes(e.category) ? e.category : 'Context',
          sub: e.subcategory || '',
          hits: Number(s.query_hits_30d || 0),
          res: Number(s.resolution_rate || 0),
          up: Number(s.thumbs_up || 0),
          down: Number(s.thumbs_down || 0),
          ver: Number(e.version || 1),
        };
      })
      .sort((a, b) => b.hits - a.hits);

    // 주간 버킷 (최근 8주)
    const weeks = weekDefs.map((w) => ({ d: w.label, t: 0, a: 0, up: 0, down: 0, aj: 0 }));
    const ajSets = weekDefs.map(() => new Set());
    for (const q of chats) {
      if (q.unit_id !== u.id) continue;
      const i = keyIndex.get(weekKey(kstMonday(q.asked_at)));
      if (i === undefined) continue;
      const w = weeks[i];
      w.t += 1;
      if (Array.isArray(q.matched_entry_ids) && q.matched_entry_ids.length > 0) w.a += 1;
      if (q.satisfaction === 'up') w.up += 1;
      if (q.satisfaction === 'down') w.down += 1;
      if (q.junior_id) ajSets[i].add(q.junior_id);
    }
    weeks.forEach((w, i) => { w.aj = ajSets[i].size; });

    const gap = unknowns
      .filter((q) => q.unit_id === u.id && q.status === 'pending_owner_answer')
      .sort((a, b) => (b.similar_queries_count || 0) - (a.similar_queries_count || 0))
      .map((q) => ({
        q: q.query_text,
        cat: CATS.includes(q.presumed_category) ? q.presumed_category : 'Context',
        sub: q.presumed_subcategory || '',
        who: q.junior_name || '알바',
        similar: Number(q.similar_queries_count || 0),
        ago: agoKo(q.asked_at, now),
      }));

    const created = new Date(u.created_at);
    const opened = `${String(created.getUTCFullYear()).slice(2)}.${String(created.getUTCMonth() + 1).padStart(2, '0')}`;

    return {
      id: u.id,
      label: `#${idx + 1}`,
      name: u.store_name || u.id,
      industry: u.industry || '기타',
      opened,
      juniors,
      weeks,
      entries: myEntries,
      gap,
    };
  });

  // ── 생성 계정 전체 목록 (profiles) — 가입순, 매장명 매핑 ──
  const unitName = new Map(units.map((u) => [u.id, u.store_name || u.id]));
  const accounts = profiles.map((p, i) => ({
    n: i + 1,
    name: (p.name && p.name.trim()) || '(이름 없음)',
    role: p.role === 'owner' ? '사장' : '알바',
    store: p.unit_id ? (unitName.get(p.unit_id) || p.unit_id) : null,
    phone: p.phone || (p.phone_last4 ? `****${p.phone_last4}` : null),
    joined: kstDateStr(p.created_at),
    ago: p.created_at ? agoKo(p.created_at, now) : '',
    deleted: !!p.deleted_at,
  }));

  const totalEntries = stores.reduce((n, s) => n + s.entries.length, 0);
  const kpis = [
    { h: '시니어 노하우 DB 누적 (전체)', now: totalEntries, target: 20, unit: '건',
      state: totalEntries >= 20 ? 'done' : totalEntries > 0 ? 'prog' : 'todo',
      note: 'S.Q.U.A.R.E. 통과 · published 기준 (실 DB)' },
    { h: '유료 매출 발생', now: 0, target: 1, unit: '건', state: 'todo',
      note: '지불 의향 X, 실제 지불 O — 결제 연동 시 자동 반영' },
    { h: '상용 도입 매장', now: units.length, target: 1, unit: '개',
      state: units.length >= 1 ? 'done' : 'todo', note: '실 매장 계정 존재 여부 (units)' },
  ];

  const DATA = {
    asOf: now.toISOString().slice(0, 10),
    containment_target: 60,
    meta: {
      connected: true,
      source: SUPABASE_URL.replace('https://', '').replace('.supabase.co', ''),
      generatedAt: now.toISOString(),
      counts: { units: units.length, profiles: profiles.length, entries: entries.length, chats: chats.length, unknowns: unknowns.length },
    },
    stores,
    accounts,
    kpis,
  };

  const banner = '// 자동 생성 파일 (fetch-dashboard-data.mjs) — 직접 편집 금지. 로컬 전용.\n';
  writeFileSync(OUT, banner + 'window.DASHBOARD_DATA = ' + JSON.stringify(DATA, null, 2) + ';\n', 'utf-8');
  console.log(`✓ 생성 완료: ${OUT}`);
  console.log(`  매장 ${stores.length} · 계정 ${accounts.length} · 노하우 ${totalEntries} · 미답변 ${stores.reduce((n, s) => n + s.gap.length, 0)}`);
})().catch((e) => {
  console.error('✗ 실패:', e.message);
  process.exit(1);
});
