// scripts/seed-space-questions-local.mjs — 로컬 공간에 "답할 질문"(대기)을 심고 지운다(2026-11-10 · 공간·매장 통합 2번 덩이).
//
// 왜 있나: 2번 덩이에는 공간에 질문을 넣을 사람이 없다(주인 질문은 연습이라 안 남고, 멤버·교육 링크는 3·4번 덩이).
//   그래서 답하기 화면(S05 답할 질문 → S09 답하기 · 보내기 / 노하우로 남기기 / 있는 노하우로 답하기)을 폰과 웹에서 보려면
//   로컬 DB 에 질문을 직접 심어야 한다. 서비스 권한으로 unknown_queries 에 넣는다(질문 넣기 정책은 공간 주인을 막는다 · 0371).
//
// ★로컬 전용. 접속 대상이 127.0.0.1/localhost 가 아니면 멈춘다(require-local-target). --allow-remote 도 받지 않는다.
//
// 사용(로컬 키는 `npx -y supabase@2 status -o env` 의 API_URL·SERVICE_ROLE_KEY):
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<로컬 키> node scripts/seed-space-questions-local.mjs --list
//   ... node scripts/seed-space-questions-local.mjs --space <공간 번호> [--n 3]     질문 n개(기본 3 · 최대 10)
//   ... node scripts/seed-space-questions-local.mjs --space <공간 번호> --clean     이 스크립트가 심은 질문만 지운다
// 심은 질문 번호 = `seedq_<공간 번호>_<시각>_<i>`. --clean 은 이 접두어만 지운다(보내기 답 글은 cascade 로 같이 지워진다).
// "노하우로 남기기"로 만든 노하우는 지우지 않는다. 앱의 노하우 상세(S08)에서 지운다.
import './lib/require-local-target.mjs'; // 접속 대상 가드 — 로컬이 아니면 멈춘다
import { createClient } from '@supabase/supabase-js';

// import 는 위로 끌어올려져 먼저 돈다. 네트워크 호출은 아래 두 검사 뒤에만 한다.
if (process.argv.includes('--allow-remote')) {
  console.error('✗ 이 스크립트는 로컬 전용이다. --allow-remote 를 받지 않는다.');
  process.exit(2);
}

const URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('✗ SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY(로컬) 가 필요하다.');
  process.exit(1);
}
const host = new globalThis.URL(URL).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`✗ 로컬 주소가 아니다: ${URL}`);
  process.exit(2);
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const db = createClient(URL, KEY, { auth: { persistSession: false } });

// 질문 예시(공간 주인이 신입에게 알려 줄 만한 일). 앞에서부터 n개.
const SAMPLES = [
  '마감 때 커피머신 청소는 어떻게 해요?',
  '우유 유통기한 지난 건 어디에 둬요?',
  '포스기에서 환불은 어떻게 해요?',
  '얼음이 다 떨어지면 어떻게 해요?',
  '주문이 몰릴 때 뭐부터 해요?',
  '컵 뚜껑 여분은 어디 있어요?',
  '영수증 용지는 어떻게 갈아요?',
  '손님이 와이파이 비번을 물으면요?',
  '마감 정산은 몇 시에 해요?',
  '쓰레기 분리수거는 언제 내놔요?',
];

async function list() {
  const { data, error } = await db.from('units').select('id, store_name, created_at').eq('kind', 'space').order('created_at').limit(50);
  if (error) throw new Error(error.message);
  if (!data.length) console.log('공간이 없다.');
  for (const u of data) console.log(`${u.id}\t${u.store_name ?? ''}`);
}

async function mustBeSpace(spaceId) {
  const { data, error } = await db.from('units').select('id, kind').eq('id', spaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`없는 자리: ${spaceId}`);
  if (data.kind !== 'space') throw new Error(`공간이 아니다(매장에는 심지 않는다): ${spaceId}`);
}

async function seed(spaceId, n) {
  await mustBeSpace(spaceId);
  const t = Date.now();
  const rows = SAMPLES.slice(0, n).map((q, i) => ({
    id: `seedq_${spaceId}_${t}_${i}`,
    unit_id: spaceId,
    junior_id: null,
    junior_name: '테스트 질문',
    query_text: q,
    asked_at: new Date(t - (n - i) * 60_000).toISOString(), // 오래된 것부터 1분 간격(목록 순서 확인용)
    presumed_category: 'Routine',
    presumed_subcategory: '일반',
    match_attempted: true,
    best_match_confidence: 0,
    status: 'pending_owner_answer',
    owner_will_answer: true,
  }));
  const { error } = await db.from('unknown_queries').insert(rows);
  if (error) throw new Error(error.message);
  console.log(`✓ ${spaceId} 에 질문 ${rows.length}개를 심었다.`);
}

async function clean(spaceId) {
  const { data, error } = await db
    .from('unknown_queries')
    .delete()
    .eq('unit_id', spaceId)
    .like('id', `seedq\\_${spaceId}\\_%`)
    .select('id');
  if (error) throw new Error(error.message);
  console.log(`✓ ${spaceId} 에서 심은 질문 ${data.length}개를 지웠다.`);
}

try {
  if (process.argv.includes('--list')) {
    await list();
  } else {
    const spaceId = arg('--space');
    if (!spaceId) throw new Error('--space <공간 번호> 가 필요하다(--list 로 찾는다).');
    if (process.argv.includes('--clean')) await clean(spaceId);
    else {
      const n = Math.min(Math.max(Number(arg('--n') ?? 3) || 3, 1), SAMPLES.length);
      await seed(spaceId, n);
    }
  }
} catch (e) {
  console.error('✗', e instanceof Error ? e.message : e);
  process.exit(1);
}
