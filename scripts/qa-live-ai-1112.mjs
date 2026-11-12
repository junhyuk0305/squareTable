// qa-live-ai-1112.mjs — 11-12 라이브 AI 확인 6건(1회용 · npm 등록 안 함).
//
//   node scripts/qa-live-ai-1112.mjs --allow-remote                         (라이브 · 사용자 승인 뒤에만)
//   node scripts/qa-live-ai-1112.mjs --allow-remote --delete-created-space  (이 스크립트가 만든 공간까지 지운다 · 아래 ★공간)
//
// 정본 = 산출물/공간매장통합_2026-11-10/야간작업_2026-11-11/아침보고_2026-11-12.md 8절 5단계 표의 1·2·3·4·6·7번.
//   5번(한도 다 찬 매장 402)과 8번(qa:task-knowhow)은 뺀다.
//   1 매장 본 갈래 답(task answer · 직원 staff2)      → 답 + 매장 사용량 +1 + 요청 키 행
//   2 문서 읽기(task doc_extract · 사장 · 2쪽 PDF)     → 사용량 + 쪽수 · `<키>:pages` 행(쪽수 - 1 몫)
//   3 공간 링크 손님 AI(edu_link_ask → edu_link_answer) → 예약 행 `edu:<cq>` + 답 + 공간 사용량 +1
//   4 매장 링크 손님 AI(사장이 만든 매장 링크)          → 답 + 매장 사용량 +1
//   6 공간 멤버 묻기(S17 · task answer · unitId = 공간) → 답 카드 + 공간 사용량 +1
//   7 앱 안 링크(S16 · 로그인 staff2)                  → 4번 손님 행을 옮겨 받기 → edu_link_me_key → 같은 손님 행으로 묻기 → 답
//
// ★AI 호출: 엣지 ai 를 부르기 직전에 센다. 한 확인당 최대 1회 · 재시도 없음 · 합계 6 이하(넘으면 부르지 않는다).
//   엣지 1회 안에서 모델이 2번 돌 수 있다(노하우가 2개 이상이면 일관성 검사). 그래서 노하우를 1개만 싣는다.
// ★계정: 고정 계정만(사장 owner · 매니저 staff · 직원 staff2 @pilot). 허용 목록(space_entry_allowlist)은 읽기만 한다.
//   셋 중 하나라도 없으면 AI 를 부르기 전에 멈춘다. 허용 목록·스위치 줄은 절대 쓰지 않는다.
// ★씨앗(이름에 qa_live_1112): 매장 링크 1 · 공간 링크 1 · (공간 노하우가 없을 때만) 공간 노하우 1 · (멤버가 아닐 때만) staff2 공간 합류.
//   끝에 try/finally 로 지운다: 링크에 딸린 질문 기록·답할 질문·알림 → 링크(손님·열쇠·이어받기·손님 질문은 cascade) · 노하우 · 합류는 leave_space.
//   고정 매장(store_001)의 기존 행은 바꾸지 않는다. 사용량(ai_usage_monthly)은 AI 를 부른 만큼 오른 채로 둔다.
// ★공간: 사장 계정은 공간을 못 만든다(0375). 매니저 staff 가 주인인 공간을 먼저 찾고(staff2 쪽도 본다) 있으면 그대로 쓰고 안 지운다.
//   없으면 staff 로 create_space 를 부른다. 지운 공간도 무료 1개에 센다(0375 ⑥) → 지우면 그 계정은 다시 공간을 못 만든다.
//   그래서 만든 공간은 기본으로 남긴다(다음 실측이 같은 공간을 쓴다). --delete-created-space 를 주면 delete_space 로 지운다.
// ★다른 하니스와 같은 고정 계정·매장을 쓴다. 동시에 돌면 사용량 차이가 어긋난다 → 여정 하니스와 겹치지 않게 돌린다.
// ★출력: 오류는 짧은 코드만 찍는다(원문·키·토큰·열쇠는 찍지 않는다). 마지막 줄 = RESULT: pass n fail n skip n · AI 호출 n회.
import './lib/require-local-target.mjs'; // 로컬이 아니면 --allow-remote 없이 접속 전에 멈춘다
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
for (const f of ['.env', '.env.seed']) {
  try {
    for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* 없으면 아래에서 멈춘다 */ }
}
const SB = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !ANON || !SRV) { console.error('중단: .env(URL·ANON) + .env.seed(서비스 키)가 필요하다'); process.exit(2); }
const EDGE = `${SB}/functions/v1/ai`;
const DELETE_CREATED_SPACE = process.argv.includes('--delete-created-space');

const TAG = 'qa_live_1112';
const UNIT = 'store_001';
const PW = 'pilot1234';
const EMAIL = {
  owner: 'owner@pilot.squaretable.app',   // 김영자 · store_001 사장
  staff: 'staff@pilot.squaretable.app',   // 박지원 · store_001 매니저
  staff2: 'staff2@pilot.squaretable.app', // 이수민 · store_001 직원
};
const EXPECTED_ROLE = { owner: 'owner', staff: 'manager', staff2: 'junior' };
const AI_MAX = 6;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(SB, SRV, opts);
const anon = createClient(SB, ANON, opts);

// ── 출력 ────────────────────────────────────────────────────────────
/** 오류는 짧은 코드만(raise 코드 모양일 때) · 그 밖은 'error'. 원문·컬럼 이름을 찍지 않는다. */
const codeOf = (e) => {
  const m = String(e?.message ?? e ?? '');
  return /^[A-Za-z_]{3,48}$/.test(m) ? m : 'error';
};
const log = (s) => console.log('   ·', s);
let pass = 0, fail = 0, skip = 0, aiCalls = 0;
const failed = [];
function verdict(no, name, ok, note) {
  if (ok) pass++; else { fail++; failed.push(no); }
  console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'} [${no}] ${name}${note ? ` — ${note}` : ''}`);
}

// ── DB 읽기(서비스 권한 · 읽기만) ────────────────────────────────────
const kstMonth = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
async function usage(unitId) {
  const { data, error } = await db.from('ai_usage_monthly').select('used').eq('unit_id', unitId).eq('month', kstMonth()).maybeSingle();
  if (error) throw new Error('usage_read_failed');
  return data?.used ?? 0;
}
async function quotaRow(key) {
  const { data, error } = await db.from('ai_quota_requests').select('unit_id').eq('request_key', key).maybeSingle();
  if (error) throw new Error('quota_row_read_failed');
  return data ?? null;
}

// ── 로그인 · 매장 ────────────────────────────────────────────────────
async function login(who) {
  const c = createClient(SB, ANON, opts);
  const { data, error } = await c.auth.signInWithPassword({ email: EMAIL[who], password: PW });
  if (error || !data?.session) throw new Error(`login_failed_${who}`);
  c.uid = data.user.id;
  c.token = data.session.access_token;
  c.who = who;
  return c;
}
async function activeUnit(c) {
  const { data, error } = await c.rpc('my_units');
  if (error) throw new Error('my_units_failed');
  return data ?? [];
}
/** 활성 매장을 store_001 로. 바꿨으면 원래 매장 id. */
async function ensureActive(c) {
  const rows = await activeUnit(c);
  const cur = rows.find((r) => r.is_active)?.unit_id ?? null;
  if (cur === UNIT) return null;
  const { error } = await c.rpc('switch_active_unit', { p_unit_id: UNIT });
  if (error) throw new Error('switch_active_unit_failed');
  log(`${c.who} 활성 매장 → ${UNIT} (끝나면 되돌림)`);
  return cur;
}

// ── 엣지 호출(셈 한 곳) ─────────────────────────────────────────────
const calledFor = new Set();
/** 엣지 ai 한 번. bearer = 로그인 토큰 또는 null(손님 · 앱처럼 anon 키). 확인마다 한 번만 · 합계 AI_MAX 까지. */
async function edge(no, body, bearer) {
  if (calledFor.has(no)) throw new Error('second_call_blocked');
  if (aiCalls >= AI_MAX) throw new Error('ai_cap_reached');
  calledFor.add(no);
  aiCalls++;
  try {
    const res = await fetch(EDGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${bearer ?? ANON}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}
const edgeNote = (r) => `엣지 ${r.status}${r.json?.error ? ` ${codeOf(r.json.error)}` : ''}${r.json?.scope ? ` scope ${r.json.scope}` : ''}`;
const newRid = () => `air${randomBytes(8).toString('hex')}`;

// ── 노하우 → 엣지 노하우 조각(client toSopSlice 와 같은 모양) ────────────
const sopOf = (e) => ({
  id: e.id,
  title: e.title,
  category: e.category,
  situation: e.square?.situation ?? '',
  steps: e.square?.action?.steps ?? [],
  donts: e.square?.extract?.dont?.trim() ? [e.square.extract.dont.trim()] : [],
  creatorName: e.creator_name ?? '',
  version: e.version ?? 1,
  updatedAt: e.updated_at ?? '',
});
const questionFor = (e) => `${String(e.title).replace(TAG, '').trim()} 어떻게 해요?`;
const ENTRY_COLS = 'id, unit_id, title, category, square, creator_name, version, updated_at';
/** 발행 · 보관 아님 · 본사 사본 아님 · 상황과 단계가 있는 노하우 하나. */
async function pickEntry(unitId) {
  const { data, error } = await db.from('playbook_entries').select(ENTRY_COLS)
    .eq('unit_id', unitId).eq('status', 'published').is('archived_at', null).is('brand_hidden_at', null).is('brand_entry_id', null)
    .order('updated_at', { ascending: false }).limit(30);
  if (error) throw new Error('entry_read_failed');
  return (data ?? []).find((e) => (e.square?.situation ?? '').trim() && (e.square?.action?.steps ?? []).length > 0) ?? null;
}

// ── 2쪽 PDF(글자만 · Helvetica) ─────────────────────────────────────
function makePdf(pages) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const objs = [];
  const n = pages.length;
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const stream = ['BT', '/F1 16 Tf', '72 740 Td', '22 TL', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const off = [];
  for (let k = 1; k < objs.length; k++) { off[k] = Buffer.byteLength(out, 'latin1'); out += `${k} 0 obj\n${objs[k]}\nendobj\n`; }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let k = 1; k < objs.length; k++) out += `${String(off[k]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1').toString('base64');
}
// 엣지 docExtractPages 와 같은 셈(supabase/functions/ai/index.ts · 쪽당 520 · 지시문 268).
function docExtractPages(u) {
  const prompt = Number(u?.promptTokenCount) || 0;
  if (prompt <= 0) return 0;
  const image = (u?.promptTokensDetails ?? []).find((d) => d?.modality === 'IMAGE')?.tokenCount;
  const pageTokens = typeof image === 'number' ? image : prompt - 268;
  return Math.min(Math.max(Math.round(pageTokens / 520), 1), 60);
}

// ── 씨앗 기록 · 정리 ────────────────────────────────────────────────
const seeds = { links: [], entries: [], joined: null, createdSpace: null, restore: [] };

async function cleanup() {
  console.log('\n── 정리');
  for (const id of seeds.links) {
    try {
      const { data: gq } = await db.from('edu_guest_questions').select('uq_id').eq('link_id', id).limit(200);
      const uqIds = (gq ?? []).map((r) => r.uq_id).filter(Boolean);
      const { data: uqByLink } = await db.from('unknown_queries').select('id').eq('link_id', id).limit(200);
      const allUq = [...new Set([...uqIds, ...(uqByLink ?? []).map((r) => r.id)])];
      let notices = 0;
      for (const uq of allUq) {
        const { data: d } = await db.from('member_notices').delete().like('url', `%${uq}%`).select('id');
        notices += d?.length ?? 0;
      }
      const uqDel = allUq.length ? (await db.from('unknown_queries').delete().in('id', allUq).select('id')).data?.length ?? 0 : 0;
      const cqDel = (await db.from('chat_queries').delete().eq('link_id', id).select('id')).data?.length ?? 0;
      const { data: ld, error: le } = await db.from('edu_links').delete().eq('id', id).select('id');
      log(`링크 ${id}: 알림 ${notices} · 답할 질문 ${uqDel} · 질문 기록 ${cqDel} · 링크 ${le ? '지우기 실패' : ld?.length ?? 0}(손님·열쇠·이어받기 cascade)`);
    } catch (e) { log(`링크 ${id} 정리 실패 ${codeOf(e)}`); }
  }
  for (const id of seeds.entries) {
    try {
      await db.from('playbook_embeddings').delete().eq('entry_id', id);
      const { data, error } = await db.from('playbook_entries').delete().eq('id', id).select('id');
      log(`공간 노하우 ${id}: ${error ? '지우기 실패' : data?.length ?? 0}`);
    } catch (e) { log(`공간 노하우 ${id} 정리 실패 ${codeOf(e)}`); }
  }
  if (seeds.joined) {
    const { c, spaceId } = seeds.joined;
    const { error } = await c.rpc('leave_space', { p_space: spaceId });
    log(`staff2 공간 나가기: ${error ? `실패 ${codeOf(error)}` : '됨'}`);
  }
  if (seeds.createdSpace) {
    const { c, spaceId } = seeds.createdSpace;
    if (DELETE_CREATED_SPACE) {
      const { error } = await c.rpc('delete_space', { p_space: spaceId });
      log(`만든 공간 ${spaceId} 지우기: ${error ? `실패 ${codeOf(error)}` : '됨(그 계정 무료 1개는 쓴 것으로 남는다)'}`);
    } else {
      log(`만든 공간 ${spaceId} 은 남겼다(지운 공간도 무료 1개에 센다 · 지우려면 --delete-created-space)`);
    }
  }
  for (const { c, prev } of seeds.restore) {
    const { error } = await c.rpc('switch_active_unit', { p_unit_id: prev });
    log(`${c.who} 활성 매장 되돌리기 → ${prev}: ${error ? `실패 ${codeOf(error)}` : '됨'}`);
  }
}

// ── 공간 준비(3·6번 공용) ────────────────────────────────────────────
/** {owner, member, spaceId, entry} 또는 throw(코드). 주인 = 공간 주인 계정 · 멤버 = 그 공간 멤버(staff·staff2 중 다른 하나). */
async function prepareSpace(C, category) {
  const spacesOf = async (c) => {
    const { data, error } = await c.rpc('my_spaces');
    if (error) throw new Error('my_spaces_failed');
    return data ?? [];
  };
  const mine = { staff: await spacesOf(C.staff), staff2: await spacesOf(C.staff2) };
  let owner = null, member = null, space = null;
  for (const [o, m] of [['staff', 'staff2'], ['staff2', 'staff']]) {
    const own = mine[o].find((s) => s.role === 'space_owner');
    if (own) { owner = C[o]; member = C[m]; space = own; break; }
  }
  if (space) {
    log(`있는 공간 사용: ${space.id}(주인 ${owner.who}) · 지우지 않는다`);
  } else {
    const { data, error } = await C.staff.rpc('create_space', { p_name: `${TAG} 공간` });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.space_id) throw new Error(`create_space ${codeOf(error)}`);
    owner = C.staff; member = C.staff2;
    space = { id: row.space_id, invite_code: row.invite_code };
    seeds.createdSpace = { c: owner, spaceId: space.id };
    log(`공간 만듦: ${space.id}(주인 staff)`);
  }
  const spaceId = space.id;

  // 멤버: 이미 멤버면 그대로 · 아니면 초대코드로 합류(끝에 leave_space).
  const memberRows = await spacesOf(member);
  if (!memberRows.some((s) => s.id === spaceId && s.role === 'space_member')) {
    const code = space.invite_code ?? (await spacesOf(owner)).find((s) => s.id === spaceId)?.invite_code;
    if (!code) throw new Error('invite_code_missing');
    const { data, error } = await member.rpc('join_space_by_code', { p_code: code });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.space_id) throw new Error(`join_space_by_code ${error ? codeOf(error) : 'no_row'}`);
    seeds.joined = { c: member, spaceId };
    log(`${member.who} 공간 합류(끝에 나간다)`);
  } else {
    log(`${member.who} 는 이미 멤버`);
  }

  // 두 세션 모두 현재 공간 = 이 공간(엣지 placeUser · auth_can 이 현재 공간을 본다 · 그 세션 기록만 바뀐다).
  for (const c of [owner, member]) {
    const { error } = await c.rpc('enter_space', { p_space: spaceId });
    if (error) throw new Error(`enter_space_${c.who} ${codeOf(error)}`);
  }

  // 공간 노하우: 있으면 그것 · 없으면 하나 심는다(서비스 권한 · 끝에 지운다).
  let entry = await pickEntry(spaceId);
  if (!entry) {
    const id = `${TAG}_${randomBytes(5).toString('hex')}`;
    const { data, error } = await db.from('playbook_entries').insert({
      id, unit_id: spaceId, category: category ?? '서비스', title: `${TAG} 컵 세척`, status: 'published', creator_role: 'space_owner',
      creator_name: TAG,
      square: {
        situation: '손님이 쓴 컵을 씻을 때',
        action: { steps: ['남은 음료를 버린다', '세제를 묻힌 스펀지로 안쪽을 닦는다', '뜨거운 물로 헹군 뒤 거꾸로 세워 말린다'] },
        extract: { dont: '철 수세미로 닦지 않는다' },
      },
    }).select(ENTRY_COLS).single();
    if (error || !data) throw new Error('space_entry_seed_failed');
    seeds.entries.push(id);
    entry = data;
    log(`공간 노하우 심음: ${id}`);
  }
  return { owner, member, spaceId, entry };
}

// ── 손님 링크 묻기 + 엣지(3·4번 공용) ────────────────────────────────
async function guestAsk(asker, token, key, name, text) {
  const { data, error } = await asker.rpc('edu_link_ask', { p_token: token, p_key: key, p_name: name, p_text: text }).single();
  if (error || !data?.cq_id) throw new Error(`edu_link_ask ${error ? codeOf(error) : 'no_row'}`);
  return data;
}
async function guestAnswerCheck(no, name, unitId, token, key, cqId) {
  const before = await usage(unitId);
  const r = await edge(no, { task: 'edu_link_answer', payload: { token, key, cqId } }, null);
  const after = await usage(unitId);
  const reserved = await quotaRow(`edu:${cqId}`);
  const answered = r.status === 200 && r.json?.grounded === true && !!r.json?.block;
  const ok = answered && after - before === 1 && reserved?.unit_id === unitId;
  verdict(no, name, ok, `${edgeNote(r)} · 답 ${answered ? '있음' : '없음'} · 사용량 ${before}→${after}(+${after - before}) · 예약 행 ${reserved ? (reserved.unit_id === unitId ? '맞음' : '자리 다름') : '없음'}`);
  return r;
}

// ════════════════════════════════════════════════════════════════════
console.log(`[qa-live-ai-1112] 대상 ${new URL(SB).host} · 이번 달 ${kstMonth()} · AI 상한 ${AI_MAX}회`);
let C = null;
try {
  // ── 0. 전제 ──
  console.log('\n── 0. 전제(로그인 · 역할 · 허용 목록)');
  C = { owner: await login('owner'), staff: await login('staff'), staff2: await login('staff2') };
  for (const [k, want] of Object.entries(EXPECTED_ROLE)) {
    const row = (await activeUnit(C[k])).find((r) => r.unit_id === UNIT);
    if (row?.role !== want) { console.error(`중단: ${EMAIL[k]} 의 ${UNIT} 역할 = ${row?.role ?? '없음'}(기대 ${want})`); process.exit(2); }
  }
  const { data: allow, error: aErr } = await db.from('space_entry_allowlist').select('user_id').limit(100);
  if (aErr) { console.error('중단: 허용 목록을 못 읽었다'); process.exit(2); }
  const allowIds = new Set((allow ?? []).map((r) => r.user_id));
  const missing = Object.keys(EMAIL).filter((k) => !allowIds.has(C[k].uid));
  log(`허용 목록 ${allowIds.size}행 · 필요한 계정 3개 중 ${3 - missing.length}개 있음`);
  if (missing.length) { console.error(`중단: 허용 목록에 없음 → ${missing.map((k) => EMAIL[k]).join(' · ')}`); process.exit(2); }
  for (const k of ['owner', 'staff2']) {
    const prev = await ensureActive(C[k]);
    if (prev) seeds.restore.push({ c: C[k], prev });
  }
  const storeEntry = await pickEntry(UNIT);
  log(storeEntry ? `매장 노하우 1개 고름: ${storeEntry.id}` : '매장 노하우 없음(1·4·7번 fail)');

  // ── 1. 매장 본 갈래 답 ──
  console.log('\n── 1. 매장 본 갈래 답(직원 · task answer)');
  try {
    if (!storeEntry) throw new Error('store_entry_missing');
    const rid = newRid();
    const before = await usage(UNIT);
    const r = await edge(1, { task: 'answer', payload: { storeId: UNIT, query: questionFor(storeEntry), sops: [sopOf(storeEntry)] }, requestId: rid }, C.staff2.token);
    const after = await usage(UNIT);
    const keyRow = await quotaRow(`${C.staff2.uid}:${rid}`);
    const answered = r.status === 200 && r.json?.grounded === true && !!r.json?.block;
    verdict(1, '매장 본 갈래 답', answered && after - before === 1 && keyRow?.unit_id === UNIT,
      `${edgeNote(r)} · 답 ${answered ? '있음' : '없음'} · 사용량 ${before}→${after}(+${after - before}) · 요청 키 행 ${keyRow ? '있음' : '없음'}`);
  } catch (e) { verdict(1, '매장 본 갈래 답', false, `씨앗·준비 실패 ${codeOf(e)}`); }

  // ── 2. 문서 읽기(쪽수 차감) ──
  console.log('\n── 2. 문서 읽기(사장 · task doc_extract · 2쪽 PDF)');
  try {
    const pdf = makePdf([
      ['Opening checklist', '1. Turn on the coffee machine.', '2. Check the milk stock in the fridge.', '3. Wipe the counter.'],
      ['Closing checklist', '1. Clean the coffee machine.', '2. Count the cash drawer.', '3. Lock the back door.'],
    ]);
    const rid = newRid();
    const key = `${C.owner.uid}:${rid}`;
    const before = await usage(UNIT);
    const r = await edge(2, { task: 'doc_extract', payload: { mimeType: 'application/pdf', docBase64: pdf }, requestId: rid }, C.owner.token);
    const after = await usage(UNIT);
    const pages = docExtractPages(r.json?.usage);
    const base = await quotaRow(key);
    const extra = await quotaRow(`${key}:pages`);
    const read = r.status === 200 && !r.json?.error && !!String(r.json?.text ?? '').trim();
    const ok = read && pages >= 2 && after - before === pages && base?.unit_id === UNIT && extra?.unit_id === UNIT;
    verdict(2, '문서 읽기 쪽수 차감', ok,
      `${edgeNote(r)} · 글 ${read ? '읽음' : '없음'} · 쪽수 ${pages} · 사용량 ${before}→${after}(+${after - before} · 기대 +${pages}) · 키 행 ${base ? '있음' : '없음'} · :pages 행 ${extra ? '있음' : '없음'}`);
  } catch (e) { verdict(2, '문서 읽기 쪽수 차감', false, `씨앗·준비 실패 ${codeOf(e)}`); }

  // ── 3·6 공용 공간 ──
  console.log('\n── 공간 준비(3·6번)');
  let sp = null;
  try { sp = await prepareSpace(C, storeEntry?.category); } catch (e) { log(`공간 준비 실패 ${codeOf(e)}`); }

  // ── 3. 공간 링크 손님 AI ──
  console.log('\n── 3. 공간 링크 손님 AI');
  try {
    if (!sp) throw new Error('space_not_ready');
    const { data, error } = await sp.owner.rpc('edu_link_create', { p_unit: sp.spaceId, p_title: `${TAG} 공간`, p_entry_ids: [sp.entry.id], p_days: 1 }).single();
    if (error || !data?.id) throw new Error(`edu_link_create ${error ? codeOf(error) : 'no_row'}`);
    seeds.links.push(data.id);
    log(`공간 링크 만듦: ${data.id}`);
    const ask = await guestAsk(anon, data.token, null, TAG, questionFor(sp.entry));
    if (!ask.ai_ready) throw new Error('space_ai_capped');
    await guestAnswerCheck(3, '공간 링크 손님 AI', sp.spaceId, data.token, ask.guest_key, ask.cq_id);
  } catch (e) { verdict(3, '공간 링크 손님 AI', false, `씨앗·준비 실패 ${codeOf(e)}`); }

  // ── 4. 매장 링크 손님 AI ──
  console.log('\n── 4. 매장 링크 손님 AI(사장이 만든 매장 링크)');
  let storeLink = null;
  try {
    if (!storeEntry) throw new Error('store_entry_missing');
    const { data, error } = await C.owner.rpc('edu_link_create', { p_unit: UNIT, p_title: `${TAG} 매장`, p_entry_ids: [storeEntry.id], p_days: 1 }).single();
    if (error || !data?.id) throw new Error(`edu_link_create ${error ? codeOf(error) : 'no_row'}`);
    seeds.links.push(data.id);
    log(`매장 링크 만듦: ${data.id}`);
    const ask = await guestAsk(anon, data.token, null, TAG, questionFor(storeEntry));
    if (!ask.ai_ready) throw new Error('store_ai_capped');
    storeLink = { id: data.id, token: data.token, guestKey: ask.guest_key, cqId: ask.cq_id };
    await guestAnswerCheck(4, '매장 링크 손님 AI', UNIT, data.token, ask.guest_key, ask.cq_id);
  } catch (e) { verdict(4, '매장 링크 손님 AI', false, `씨앗·준비 실패 ${codeOf(e)}`); }

  // ── 6. 공간 멤버 묻기(S17) ──
  console.log('\n── 6. 공간 멤버 묻기(S17 · task answer · unitId = 공간)');
  try {
    if (!sp) throw new Error('space_not_ready');
    const rid = newRid();
    const before = await usage(sp.spaceId);
    const r = await edge(6, {
      task: 'answer', payload: { storeId: sp.spaceId, query: questionFor(sp.entry), sops: [sopOf(sp.entry)] }, requestId: rid, unitId: sp.spaceId,
    }, sp.member.token);
    const after = await usage(sp.spaceId);
    const keyRow = await quotaRow(`${sp.member.uid}:${rid}`);
    const answered = r.status === 200 && r.json?.grounded === true && !!r.json?.block;
    verdict(6, '공간 멤버 묻기', answered && after - before === 1 && keyRow?.unit_id === sp.spaceId,
      `${edgeNote(r)} · 답 카드 ${answered ? '있음' : '없음'} · 공간 사용량 ${before}→${after}(+${after - before}) · 요청 키 행 ${keyRow ? (keyRow.unit_id === sp.spaceId ? '공간' : '자리 다름') : '없음'}`);
  } catch (e) { verdict(6, '공간 멤버 묻기', false, `씨앗·준비 실패 ${codeOf(e)}`); }

  // ── 7. 앱 안 링크(S16) 로그인 사용자 ──
  console.log('\n── 7. 앱 안 링크(S16 · staff2 로그인 · 4번 링크)');
  try {
    if (!storeLink) throw new Error('store_link_missing');
    const u = C.staff2;
    const { data: cg, error: cgErr } = await u.rpc('edu_link_claim_guest', { p_key: storeLink.guestKey });
    const claimed = Array.isArray(cg) ? cg[0] : cg;
    if (cgErr || !claimed?.claimed) throw new Error(`edu_link_claim_guest ${cgErr ? codeOf(cgErr) : 'not_claimed'}`);
    const { data: mine, error: mErr } = await u.rpc('my_edu_links');
    if (mErr || !(mine ?? []).some((l) => l.link_id === storeLink.id)) throw new Error('my_edu_links_missing');
    const { data: mk, error: mkErr } = await u.rpc('edu_link_me_key', { p_link: storeLink.id }).single();
    if (mkErr || !mk?.key) throw new Error(`edu_link_me_key ${mkErr ? codeOf(mkErr) : 'no_row'}`);
    const ask = await guestAsk(u, mk.token, mk.key, mk.name, `${questionFor(storeEntry).replace(/\?$/, '')} 다시 알려 주세요`);
    if (!ask.ai_ready) throw new Error('store_ai_capped');
    const { data: gq } = await db.from('edu_guest_questions').select('cq_id, guest_id').in('cq_id', [storeLink.cqId, ask.cq_id]);
    const g = Object.fromEntries((gq ?? []).map((r) => [r.cq_id, r.guest_id]));
    const sameGuest = !!g[ask.cq_id] && g[ask.cq_id] === g[storeLink.cqId];
    const before = await usage(UNIT);
    const r = await edge(7, { task: 'edu_link_answer', payload: { token: mk.token, key: mk.key, cqId: ask.cq_id } }, null);
    const after = await usage(UNIT);
    const answered = r.status === 200 && r.json?.grounded === true && !!r.json?.block;
    verdict(7, '앱 안 링크 로그인 사용자', answered && sameGuest && mk.token === storeLink.token && ask.guest_key == null,
      `${edgeNote(r)} · 답 ${answered ? '있음' : '없음'} · 같은 손님 행 ${sameGuest ? '맞음' : '다름'} · 새 손님 열쇠 ${ask.guest_key == null ? '안 생김' : '생김'} · (참고) 매장 사용량 ${before}→${after}`);
  } catch (e) { verdict(7, '앱 안 링크 로그인 사용자', false, `씨앗·준비 실패 ${codeOf(e)}`); }
} catch (e) {
  console.error(`중단: ${codeOf(e)}`);
  fail++;
} finally {
  try { await cleanup(); } catch (e) { console.log(`   · 정리 중 오류 ${codeOf(e)}`); }
}

const ran = pass + fail;
if (ran < 6) { const notRun = 6 - ran; fail += notRun; console.log(`  ✗ 돌지 못한 확인 ${notRun}개를 fail 로 센다`); }
console.log(`\nRESULT: pass ${pass} fail ${fail} skip ${skip} · AI 호출 ${aiCalls}회${failed.length ? ` · 실패 [${failed.join(', ')}]` : ''}`);
process.exit(fail ? 1 : 0);
