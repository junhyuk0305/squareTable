#!/usr/bin/env node
// qa-invariants-once.mjs — 운영 불변식 1회 점검 (메가프롬프트_오류탐지_범용오라클_2026-10-17 §4).
//   라이브 DB 를 service_role 로 **읽기만** 한다(select 만 · rpc 없음). 크론·스케줄 아님 — 사람이 한 번 돌린다.
//   출력은 개수·id·날짜뿐. 질문·노하우 본문·이름·전화·이메일 열은 가져오지도 않거나(질문 본문은 중복 판정에만 메모리에서 해시) 찍지 않는다.
//   사용: node scripts/qa-invariants-once.mjs [--json]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
for (const f of ['.env', '.env.seed']) {
  try {
    for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch { /* 없으면 아래에서 막힌다 */ }
}
const SB = env.EXPO_PUBLIC_SUPABASE_URL;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !SRV) { console.error('FAIL: .env(URL) + .env.seed(SUPABASE_SERVICE_ROLE_KEY) 필요'); process.exit(2); }
const db = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const AS_JSON = process.argv.includes('--json');

class Unmeasurable extends Error {}

/** 테이블 전체를 1000행씩 읽는다. 열/테이블이 없으면 Unmeasurable. */
async function all(table, cols, order, apply) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(cols);
    if (apply) q = apply(q);
    for (const o of order) q = q.order(o, { ascending: true });
    const { data, error } = await q.range(from, from + 999);
    if (error) {
      if (['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error.code) || /column|relation|does not exist/i.test(error.message)) {
        throw new Unmeasurable(`열/테이블 없음 — 측정 불가 (${table}: ${error.code})`);
      }
      throw new Error(`${table}: ${error.code} ${error.message}`);
    }
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const results = [];
/** 불변식 하나. fn 은 { n, samples(id[]), note? } 를 돌려준다. */
async function inv(name, fn) {
  try {
    const r = await fn();
    results.push({ name, n: r.n, samples: (r.samples ?? []).slice(0, 5), note: r.note ?? '', info: !!r.info });
  } catch (e) {
    results.push({ name, n: null, samples: [], note: e instanceof Unmeasurable ? e.message : `오류: ${e.message}` });
  }
}
const group = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};
const iso = (d) => (d ? String(d).slice(0, 10) : '-');
const CUT_0275 = '2026-10-06'; // mark_quiz_completed 가 응시 기록으로 판정하기 시작한 날(0275)

// ── 공용 로드 (id·키 열만) ───────────────────────────────────────────────
const units = await all('units', 'id,owner_id,deleted_at', ['id']);
const unitById = new Map(units.map((u) => [u.id, u]));
const profiles = await all('profiles', 'id,unit_id,active_unit_id,pending_unit_id,role,deleted_at', ['id']);
const members = await all('unit_members', 'user_id,unit_id,role', ['user_id', 'unit_id']);
const entries = await all('playbook_entries', 'id,unit_id', ['id']);
const entryById = new Map(entries.map((e) => [e.id, e]));

// ① 서버 상태 ─────────────────────────────────────────────────────────────
const uqs = await all('unknown_queries', 'id,unit_id,status,resolved_with_entry_id,query_text', ['id']);
await inv('①-a 질문 resolved_with_entry 인데 resolved_with_entry_id 가 null 이거나 그 노하우가 없음', async () => {
  const bad = uqs.filter((q) => q.status === 'resolved_with_entry' && (!q.resolved_with_entry_id || !entryById.has(q.resolved_with_entry_id)));
  return { n: bad.length, samples: bad.map((q) => q.id), note: `resolved_with_entry 총 ${uqs.filter((q) => q.status === 'resolved_with_entry').length}건 중` };
});
await inv('①-b 같은 질문을 가리키는 노하우 2건 이상 (노하우→질문 열 없음 · 대리: 같은 매장·같은 질문 글자에 서로 다른 해결 노하우 2개+)', async () => {
  const res = uqs.filter((q) => q.status === 'resolved_with_entry' && q.resolved_with_entry_id);
  const g = group(res, (q) => q.unit_id + '|' + createHash('sha1').update(String(q.query_text ?? '').trim().replace(/\s+/g, ' ')).digest('hex'));
  const bad = [...g.values()].filter((rows) => new Set(rows.map((r) => r.resolved_with_entry_id)).size >= 2);
  return { n: bad.length, samples: bad.map((rows) => rows.map((r) => r.id).join('+')), note: '대리 측정(같은 질문 글자). 다른 사람이 같은 말을 다시 묻는 정상 경우도 섞인다' };
});
await inv('①-c 한 노하우를 여러 질문이 해결 기록으로 가리킴', async () => {
  const g = group(uqs.filter((q) => q.resolved_with_entry_id), (q) => q.resolved_with_entry_id);
  const bad = [...g.entries()].filter(([, r]) => r.length >= 2);
  return { n: bad.length, samples: bad.map(([k]) => k) };
});

const qas = await all('quiz_assignments', 'id,unit_id,user_id,course_id,scheduled_on,sent_at,due_on,opened_at,completed_at', ['id']);
const attempts = await all('quiz_attempts', 'id,unit_id,staff_id,taken_at', ['id'], (q) => q.not('staff_id', 'is', null));
await inv('①-d 발송 없는데(sent_at null) completed_at 있음', async () => {
  const bad = qas.filter((a) => !a.sent_at && a.completed_at);
  return { n: bad.length, samples: bad.map((a) => a.id), note: `배정 총 ${qas.length}건` };
});
await inv(`①-e completed_at 있는데 발송(sent_at) 이후 그 직원의 응시 0건 — sent_at ${CUT_0275} 이후만(0275 이후)`, async () => {
  const byUser = group(attempts, (t) => t.unit_id + '|' + t.staff_id);
  const done = qas.filter((a) => a.completed_at && a.sent_at);
  const bad = done.filter((a) => !(byUser.get(a.unit_id + '|' + a.user_id) ?? []).some((t) => t.taken_at >= a.sent_at));
  const post = bad.filter((a) => iso(a.sent_at) >= CUT_0275);
  const pre = bad.length - post.length;
  return { n: post.length, samples: post.map((a) => a.id), note: `0275 전 발송분(제외) ${pre}건 · 완료 총 ${done.length}건. 0275 는 '이미 카드에 안 뜨는 노하우'를 응시 없이 끝남으로 쳐서 일부는 설계상 허용일 수 있음` };
});
await inv('①-f completed_at < sent_at 또는 opened_at < sent_at 또는 due_on < scheduled_on (시간 역전)', async () => {
  const bad = qas.filter((a) => (a.completed_at && a.sent_at && a.completed_at < a.sent_at)
    || (a.opened_at && a.sent_at && a.opened_at < a.sent_at) || (a.due_on && a.due_on < a.scheduled_on));
  return { n: bad.length, samples: bad.map((a) => a.id) };
});

const courses = await all('training_courses', 'id,unit_id', ['id']);
const courseById = new Map(courses.map((c) => [c.id, c]));
const ce = await all('course_entries', 'course_id,entry_id,unit_id', ['course_id', 'entry_id']);
const ceByCourse = group(ce, (r) => r.course_id);
const items = await all('quiz_items', 'id,unit_id,entry_ids,course_id,status', ['id']);
await inv('①-g quiz_items.course_id 가 가리키는 코스가 없음', async () => {
  const bad = items.filter((i) => i.course_id && !courseById.has(i.course_id));
  return { n: bad.length, samples: bad.map((i) => i.id), note: `course_id 있는 문항 ${items.filter((i) => i.course_id).length} / 전체 ${items.length} (FK set null 이라 구조상 0)` };
});
await inv('①-h 활성 문항(course_id 있음)의 근거 노하우가 그 코스 course_entries 에 하나도 없음', async () => {
  const bad = items.filter((i) => i.status === 'active' && i.course_id && courseById.has(i.course_id)
    && !(i.entry_ids ?? []).some((e) => (ceByCourse.get(i.course_id) ?? []).some((r) => r.entry_id === e)));
  return { n: bad.length, samples: bad.map((i) => i.id) };
});
await inv('①-i 활성 문항의 근거 노하우(entry_ids)가 playbook_entries 에 없음', async () => {
  const bad = items.filter((i) => i.status === 'active' && (i.entry_ids ?? []).some((e) => !entryById.has(e)));
  return { n: bad.length, samples: bad.map((i) => i.id) };
});

// ② 파생 수 ──────────────────────────────────────────────────────────────
await inv('② work_feed task_done 가 같은 (매장·날짜·할일) 에 2행 이상', async () => {
  const rows = await all('work_feed', 'id,unit_id,feed_date,kind:data->>kind,ref:data->>refId', ['id'], (q) => q.eq('data->>kind', 'task_done'));
  const g = group(rows, (r) => `${r.unit_id}|${r.feed_date}|${r.ref}`);
  const bad = [...g.values()].filter((r) => r.length >= 2);
  const noRef = rows.filter((r) => !r.ref).length;
  return { n: bad.length, samples: bad.map((r) => r.map((x) => x.id).join('+')), note: `task_done 총 ${rows.length}행 · refId 없는 행 ${noRef}` };
});

// ③ 본문 ─────────────────────────────────────────────────────────────────
const notices = await all('member_notices', 'id,user_id,unit_id,kind,store_name,title,created_at,claimed_at', ['id']);
await inv('③-a member_notices 에 store_name null 행', async () => {
  const bad = notices.filter((n) => n.store_name == null);
  return { n: bad.length, samples: bad.map((n) => n.id), note: `총 ${notices.length}행 · 종류별 ${JSON.stringify(Object.fromEntries([...group(bad, (n) => n.kind)].map(([k, v]) => [k, v.length])))}` };
});
await inv('③-b member_notices 에 title 빈 행', async () => {
  const bad = notices.filter((n) => !String(n.title ?? '').trim());
  return { n: bad.length, samples: bad.map((n) => n.id) };
});

// ④⑤ 인앱·착지 ──────────────────────────────────────────────────────────
await inv('④-a 푸시 토큰 0건인 매장 멤버 (정보 · 매장별 비율)', async () => {
  const toks = await all('push_device_tokens', 'id,user_id', ['id']);
  const has = new Set(toks.map((t) => t.user_id));
  const live = members.filter((m) => unitById.get(m.unit_id) && !unitById.get(m.unit_id).deleted_at);
  const noTok = live.filter((m) => !has.has(m.user_id));
  const byUnit = group(live, (m) => m.unit_id);
  const rank = [...byUnit.entries()].map(([u, ms]) => ({ u, no: ms.filter((m) => !has.has(m.user_id)).length, all: ms.length }))
    .filter((x) => x.no > 0).sort((a, b) => b.no - a.no);
  return { n: noTok.length, samples: rank.map((x) => `${x.u}(${x.no}/${x.all})`), info: true,
    note: `멤버 ${live.length}명 중 토큰 없음 ${noTok.length}명 · 토큰 없는 멤버가 있는 매장 ${rank.length}/${byUnit.size}곳 · 표본=매장(없음/전체)` };
});
await inv('④-b member_notices 중 claimed_at 없이 2일 넘은 행', async () => {
  const lim = new Date(Date.now() - 2 * 86400e3).toISOString();
  const bad = notices.filter((n) => !n.claimed_at && n.created_at < lim);
  return { n: bad.length, samples: bad.map((n) => `${n.id}(${iso(n.created_at)})`), note: `claimed_at null 총 ${notices.filter((n) => !n.claimed_at).length}` };
});

// ⑥⑦ 결과 ───────────────────────────────────────────────────────────────
await inv('⑥-a profiles.pending_unit_id 가 가리키는 매장이 없거나 삭제됨', async () => {
  const bad = profiles.filter((p) => p.pending_unit_id && (!unitById.get(p.pending_unit_id) || unitById.get(p.pending_unit_id).deleted_at));
  return { n: bad.length, samples: bad.map((p) => p.id), note: `pending 있는 프로필 ${profiles.filter((p) => p.pending_unit_id).length}` };
});
await inv('⑥-b 이미 멤버인 매장을 pending 으로도 가짐 (F1 류)', async () => {
  const mem = new Set(members.map((m) => m.user_id + '|' + m.unit_id));
  const bad = profiles.filter((p) => p.pending_unit_id && (mem.has(p.id + '|' + p.pending_unit_id) || p.unit_id === p.pending_unit_id));
  return { n: bad.length, samples: bad.map((p) => p.id) };
});

// ⑧ 멱등 ────────────────────────────────────────────────────────────────
await inv('⑧-a work_done 같은 (매장·날짜·할일) 2행', async () => {
  // PK(unit_id, work_date, template_id) 라 구조상 0. 키 열만 세어 확인한다.
  const rows = await all('work_done', 'unit_id,work_date,template_id', ['unit_id', 'work_date', 'template_id']);
  const g = group(rows, (r) => `${r.unit_id}|${r.work_date}|${r.template_id}`);
  const bad = [...g.entries()].filter(([, r]) => r.length >= 2);
  return { n: bad.length, samples: bad.map(([k]) => k), note: `총 ${rows.length}행 · PK 가 막으므로 0 이 정상(사람 열은 data jsonb 안이라 따로 안 봄)` };
});
await inv('⑧-b swap_requests 같은 (매장·근무·날짜) open 2행 이상', async () => {
  const rows = await all('swap_requests', 'id,unit_id,template_id,date,status', ['id'], (q) => q.eq('status', 'open'));
  const g = group(rows, (r) => `${r.unit_id}|${r.template_id}|${r.date}`);
  const bad = [...g.values()].filter((r) => r.length >= 2);
  return { n: bad.length, samples: bad.map((r) => r.map((x) => x.id).join('+')), note: `open 총 ${rows.length}행 · 부분 유니크 없음(0016 인덱스는 일반)` };
});
await inv('⑧-c shift_change_requests 같은 (근무·날짜) pending 2행 이상', async () => {
  const rows = await all('shift_change_requests', 'id,template_id,date,status', ['id'], (q) => q.eq('status', 'pending'));
  const g = group(rows, (r) => `${r.template_id}|${r.date}`);
  const bad = [...g.values()].filter((r) => r.length >= 2);
  return { n: bad.length, samples: bad.map((r) => r.map((x) => x.id).join('+')), note: `pending 총 ${rows.length}행 · 부분 유니크 shift_change_requests_one_pending(0243) 있음` };
});

// 격리 ──────────────────────────────────────────────────────────────────
await inv('격리-a unit_members 가 없는 매장을 가리킴 (고아)', async () => {
  const bad = members.filter((m) => !unitById.has(m.unit_id));
  return { n: bad.length, samples: bad.map((m) => `${m.user_id}@${m.unit_id}`), note: `멤버십 총 ${members.length} (FK cascade 라 구조상 0)` };
});
await inv('격리-b 살아있는 owner 프로필인데 어느 매장에도 owner 멤버십 없음', async () => {
  const ownerSet = new Set(members.filter((m) => m.role === 'owner').map((m) => m.user_id));
  const bad = profiles.filter((p) => p.role === 'owner' && !p.deleted_at && !ownerSet.has(p.id));
  const owns = new Set(units.filter((u) => !u.deleted_at).map((u) => u.owner_id));
  const withUnit = bad.filter((p) => owns.has(p.id));
  return { n: bad.length, samples: bad.map((p) => p.id), note: `그중 살아있는 매장을 소유한 사람 ${withUnit.length}명 (이쪽이 진짜 위반) · 나머지는 가입만 하고 매장 없음` };
});
await inv('격리-c 살아있는 매장의 owner_id 사장에게 그 매장 owner 멤버십이 없음 (0233 재확인)', async () => {
  const mem = new Set(members.filter((m) => m.role === 'owner').map((m) => m.user_id + '|' + m.unit_id));
  const pr = new Map(profiles.map((p) => [p.id, p]));
  const bad = units.filter((u) => !u.deleted_at && u.owner_id && pr.get(u.owner_id) && !pr.get(u.owner_id).deleted_at
    && (pr.get(u.owner_id).active_unit_id === u.id || pr.get(u.owner_id).unit_id === u.id) && !mem.has(u.owner_id + '|' + u.id));
  return { n: bad.length, samples: bad.map((u) => u.id) };
});
await inv('격리-d course_entries 의 매장이 코스 매장 또는 노하우 매장과 다름', async () => {
  const bad = ce.filter((r) => courseById.get(r.course_id)?.unit_id !== r.unit_id || entryById.get(r.entry_id)?.unit_id !== r.unit_id);
  return { n: bad.length, samples: bad.map((r) => `${r.course_id}/${r.entry_id}`), note: `course_entries 총 ${ce.length}` };
});
await inv('격리-e 활성 문항 근거 노하우(entry_ids)가 문항과 다른 매장 것', async () => {
  const bad = items.filter((i) => (i.entry_ids ?? []).some((e) => entryById.has(e) && entryById.get(e).unit_id !== i.unit_id));
  return { n: bad.length, samples: bad.map((i) => i.id) };
});
await inv('격리-f profiles.unit_id 가 없거나 삭제된 매장을 가리킴', async () => {
  const bad = profiles.filter((p) => !p.deleted_at && p.unit_id && (!unitById.get(p.unit_id) || unitById.get(p.unit_id).deleted_at));
  return { n: bad.length, samples: bad.map((p) => p.id) };
});
await inv('격리-g 주매장(profiles.unit_id)이 있는데 그 매장 멤버십이 없음 (살아있는 프로필)', async () => {
  const mem = new Set(members.map((m) => m.user_id + '|' + m.unit_id));
  const bad = profiles.filter((p) => !p.deleted_at && p.unit_id && unitById.get(p.unit_id) && !unitById.get(p.unit_id).deleted_at && !mem.has(p.id + '|' + p.unit_id));
  return { n: bad.length, samples: bad.map((p) => p.id) };
});
await inv('격리-h 응시(직원)의 staff 가 그 매장 멤버가 아님 (탈퇴·재입사 포함 · 정보)', async () => {
  const mem = new Set(members.map((m) => m.user_id + '|' + m.unit_id));
  const bad = attempts.filter((t) => !mem.has(t.staff_id + '|' + t.unit_id));
  return { n: bad.length, samples: bad.map((t) => t.id), info: true, note: `직원 응시 총 ${attempts.length}` };
});

// 옛 앱 ─────────────────────────────────────────────────────────────────
await inv('옛 앱 최근 7일 quiz_staff_record · mark_quiz_completed 오류 (client_errors 건수 · 비율은 성공 호출 계측이 없어 측정 불가)', async () => {
  const since = new Date(Date.now() - 7 * 86400e3).toISOString();
  const rows = await all('client_errors', 'id,context,code,created_at', ['id'], (q) => q.gte('created_at', since));
  const q = rows.filter((r) => /quiz/i.test(r.context ?? ''));
  const byCtx = Object.fromEntries([...group(q, (r) => `${r.context}/${r.code ?? '-'}`)].map(([k, v]) => [k, v.length]));
  return { n: q.length, samples: q.map((r) => r.id), info: true,
    note: `최근 7일 client_errors 전체 ${rows.length}건 · quiz 관련 ${q.length}건 ${JSON.stringify(byCtx)} · 호출 총수 계측 없음 → 비율 측정 불가` };
});

// ── 출력 ───────────────────────────────────────────────────────────────
if (AS_JSON) {
  console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
} else {
  let bad = 0, cant = 0;
  for (const r of results) {
    const tag = r.n === null ? '측정불가' : r.info ? '정보' : r.n === 0 ? 'OK' : 'VIOLATION';
    if (tag === 'VIOLATION') bad++;
    if (tag === '측정불가') cant++;
    console.log(`[${tag}] ${r.name}\n    n=${r.n} 표본=${r.samples.join(', ') || '-'}\n    ${r.note}`);
  }
  console.log(`\n불변식 ${results.length}개 · 위반 있음 ${bad} · 측정 불가 ${cant}`);
}
