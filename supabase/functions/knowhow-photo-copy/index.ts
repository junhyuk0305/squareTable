// knowhow-photo-copy — 공간 제안 승인 뒤 사진을 매장 폴더로 복사한다 (야간 작업 11-11 · sb · 5번 덩이 사진 길)
//
// 정본: 야간작업_2026-11-11/계약.md 1-3 · 사용자 결정 9(11-11 밤) · 마이그레이션 0581
// 왜: 승인자는 공간 폴더를 못 읽는다(사진 정책 0377). 0490 승인은 사본의 photos 를 비우고 원본 경로만 돌려준다.
//   그래서 서비스 키로 복사한다. 서비스 키는 모든 폴더에 닿으므로 권한 검증이 이 함수의 본체다.
//
// 요청: POST { suggestionId } + 로그인 토큰(Authorization: Bearer <사용자 access token>)
// 응답: 200 { photos: string[], skipped: number } · 400 invalid_argument · 401 unauthorized · 403 forbidden · 409 not_ready · 500 failed
//   응답 본문에 원문 오류를 싣지 않는다(AGENTS ⑨ · 원문은 console.error 로만).
//
// 검증(판정 한 곳 = DB 함수 _proposal_photo_source · service_role 만):
//   ① 토큰으로 사람을 확인한다. anon 키·만료 토큰 = 401.
//   ② 부른 사람이 그 제안 매장(unit_id)의 owner·manager 이고 매장·좌석이 잠기지 않았다. 없는 제안도 403(있는지 알려 주지 않는다).
//      매니저가 자기가 보낸 제안을 승인한 경우도 된다(결정 193).
//   ③ 제안이 from_space · approved · 결과 노하우 있음. 아니면 409.
//   ④ 복사할 경로 = 그 제안 source_snapshot.photos 뿐(본문 값은 받지 않는다). 첫 폴더 = 보낸 공간이 아니면 건너뛴다.
//      여기서도 한 번 더 본다(DB 판정과 같은 규칙).
//   ⑤ 사본 경로 = {매장}/{ts}-{rand}.{ext}. 원본이 없으면 그 장만 건너뛴다(skipped).
//   ⑥ _set_proposal_photos 로 적는다. 결과 노하우에 이미 사진이 있으면 그 목록을 돌려준다(두 번 불러도 한 번).
//      동시에 두 번 와서 내 사본이 안 쓰였으면 내 사본 파일을 지운다(고아 파일을 남기지 않는다).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BUCKET = 'playbook-photos';
const MAX_PHOTOS = 20;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PATH_RE = /^[^/]+\/[A-Za-z0-9._-]{1,200}$/;

// 허용 출처(쉼표구분) — ai 엣지와 같은 규칙. 미설정 시 '*'(개발 편의).
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',').map((s) => s.trim()).filter(Boolean);

function corsFor(origin: string | null) {
  const allow = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

type Source = {
  status: 'ok' | 'forbidden' | 'not_ready';
  store?: string;
  source?: string;
  existing?: string[];
  paths?: string[];
};

function extOf(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) && ext !== path.toLowerCase() ? ext : 'jpg';
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('knowhow-photo-copy misconfigured: SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY');
    return json({ error: 'failed' }, 500);
  }

  // ① 사람 확인(anon 키만으로는 getUser 가 실패한다).
  const authz = req.headers.get('Authorization') ?? '';
  if (!authz.toLowerCase().startsWith('bearer ')) return json({ error: 'unauthorized' }, 401);
  const userSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authz } },
    auth: { persistSession: false },
  });
  const { data: who, error: whoErr } = await userSb.auth.getUser();
  if (whoErr || !who?.user?.id) return json({ error: 'unauthorized' }, 401);
  const uid = who.user.id;

  let suggestionId = '';
  try {
    const body = await req.json();
    suggestionId = typeof body?.suggestionId === 'string' ? body.suggestionId : '';
  } catch { /* 아래에서 400 */ }
  if (!ID_RE.test(suggestionId)) return json({ error: 'invalid_argument' }, 400);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const copied: string[] = [];
  const removeCopied = async () => {
    if (copied.length === 0) return;
    const { error } = await svc.storage.from(BUCKET).remove(copied);
    if (error) console.error('knowhow-photo-copy: remove copies failed:', error.message);
  };

  try {
    // ②③④ 판정 한 곳.
    const { data: srcData, error: srcErr } = await svc.rpc('_proposal_photo_source', { p_suggestion: suggestionId, p_uid: uid });
    if (srcErr) {
      console.error('knowhow-photo-copy: source failed:', srcErr.message);
      return json({ error: 'failed' }, 500);
    }
    const src = (srcData ?? { status: 'forbidden' }) as Source;
    if (src.status === 'forbidden') return json({ error: 'forbidden' }, 403);
    if (src.status !== 'ok' || !src.store || !src.source) return json({ error: 'not_ready' }, 409);

    const existing = Array.isArray(src.existing) ? src.existing : [];
    if (existing.length > 0) return json({ photos: existing, skipped: 0 });

    // ④ 한 번 더: 첫 폴더 = 보낸 공간 · 모양 · '..' 없음.
    const all = Array.isArray(src.paths) ? src.paths : [];
    const paths = [...new Set(all)].filter(
      (p) => typeof p === 'string' && PATH_RE.test(p) && !p.includes('..') && p.split('/')[0] === src.source,
    ).slice(0, MAX_PHOTOS);
    let skipped = all.length - paths.length;

    // ⑤ 복사. 원본이 없으면(그사이 지워짐) 그 장만 건너뛴다.
    for (const from of paths) {
      const dest = `${src.store}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${extOf(from)}`;
      const { error } = await svc.storage.from(BUCKET).copy(from, dest);
      if (error) {
        console.error('knowhow-photo-copy: copy skipped:', error.message);
        skipped += 1;
        continue;
      }
      copied.push(dest);
    }
    if (copied.length === 0) return json({ photos: [], skipped });

    // ⑥ 기록(두 번 불러도 한 번).
    const { data: setData, error: setErr } = await svc.rpc('_set_proposal_photos', { p_suggestion: suggestionId, p_paths: copied });
    if (setErr) {
      console.error('knowhow-photo-copy: set failed:', setErr.message);
      await removeCopied();
      return json({ error: 'failed' }, 500);
    }
    const photos = Array.isArray(setData) ? (setData as string[]) : [];
    const used = new Set(photos);
    if (copied.some((p) => !used.has(p))) {
      // 다른 호출이 먼저 적었다 → 내 사본은 쓰이지 않는다.
      const unused = copied.filter((p) => !used.has(p));
      copied.length = 0;
      copied.push(...unused);
      await removeCopied();
      return json({ photos, skipped: 0 });
    }
    return json({ photos, skipped });
  } catch (e) {
    console.error('knowhow-photo-copy: unexpected:', e instanceof Error ? e.message : String(e));
    await removeCopied();
    return json({ error: 'failed' }, 500);
  }
});
