// supabase/functions/push/index.ts  (Deno / Supabase Edge Function)
// 웹푸시(브라우저 Push API) 발송 — 인앱 이벤트가 발생하면 클라이언트가 이걸 호출해
// 대상 사용자의 구독(push_subscriptions)으로 실제 OS 알림을 쏜다.
//
// 보안 (ai 함수와 동일 정책):
//   - 호출자 JWT 필수(anon 단독 거부). 발송자는 실제 로그인 유저여야 한다.
//   - 발송 대상은 "호출자와 같은 매장(unit_id)" 으로만 강제 — 임의 유저 스팸 차단.
//     audience='user' 로 특정 대상을 지정해도 그 대상의 unit_id 가 호출자와 다르면 거부.
//   - 매장당 분당 레이트리밋 → 알림 폭탄/비용 방어.
//   - 발송 중 404/410(구독 만료) 은 그 구독행을 즉시 삭제(죽은 구독 누적 방지).
//
// 배포:
//   supabase functions deploy push
//   supabase secrets set VAPID_PUBLIC_KEY=...  VAPID_PRIVATE_KEY=...  VAPID_SUBJECT=mailto:contact@team-roundtable.com
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY 는 플랫폼이 기본 주입)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contact@team-roundtable.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',').map((s) => s.trim()).filter(Boolean);

// 발송 한도 — 매장당 분당. 정상 트래픽(합류/공지/교대)은 이보다 훨씬 낮다.
const RATE_PER_MIN = 60;
const hits = new Map<string, { n: number; resetAt: number }>();

// 입력 하드캡(알림 본문 폭주 방지)
const MAX_TITLE = 120;
const MAX_BODY = 300;
const MAX_URL = 300;

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

function rateLimited(key: string): boolean {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now > cur.resetAt) {
    hits.set(key, { n: 1, resetAt: now + 60_000 });
    return false;
  }
  cur.n += 1;
  return cur.n > RATE_PER_MIN;
}

function clip(s: unknown, max: number): string {
  return String(s ?? '').slice(0, max);
}

// ── 방해 금지(quiet hours) 판정 — KST 고정(단일시장) ──────────────────────────────
// 클라 설정은 "HH:MM"(KST)로 저장된다. 현재 KST 시각도 "HH:MM"으로 만들어 고정폭 문자열
// 사전순 비교로 판정한다(zero-padded 라 사전순 = 시간순).
function kstNowHHMM(): string {
  // en-GB + hour12:false → "HH:MM:SS". 앞 5글자가 "HH:MM".
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour12: false }).slice(0, 5);
}
// now 가 [start, end) 방해금지 구간 안인가. start>end 면 자정 넘김(예: 22:00~08:00).
function inQuietWindow(now: string, start?: string | null, end?: string | null): boolean {
  const s = String(start ?? '').slice(0, 5);
  const e = String(end ?? '').slice(0, 5);
  if (!/^\d\d:\d\d$/.test(s) || !/^\d\d:\d\d$/.test(e) || s === e) return false; // 형식 이상·빈 구간 = 억제 안 함(안전측)
  return s < e ? (now >= s && now < e) : (now >= s || now < e);
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const cors = corsFor(origin);
  const json = (status: number, obj: unknown) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json(500, { error: 'vapid_not_configured' });
  }

  // ── 호출자 인증 ── (JWT 없으면 거부. anon 프록시화 차단.)
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'unauthorized' });

  // 호출자 신원 확인용(anon 키 + 호출자 토큰)
  const asCaller = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  const caller = userData?.user;
  if (userErr || !caller) return json(401, { error: 'unauthorized' });

  // 조회/발송은 service_role(RLS 우회) — 대상 프로필·구독을 읽어야 한다.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 호출자의 매장(unit_id) + 신청 대기중 매장(pending_unit_id).
  const { data: me } = await admin
    .from('profiles').select('unit_id, pending_unit_id, role').eq('id', caller.id).single();
  const callerUnit = me?.unit_id as string | null;
  const pendingUnit = me?.pending_unit_id as string | null;

  let payload: {
    audience?: 'owners' | 'staff' | 'user' | 'join_owners';
    userId?: string;
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }

  const audience = payload.audience;
  const title = clip(payload.title, MAX_TITLE);
  const body = clip(payload.body, MAX_BODY);
  const url = clip(payload.url, MAX_URL);
  const tag = clip(payload.tag, 80) || undefined;
  if (!title || !audience) return json(400, { error: 'missing_fields' });

  // 발송 범위가 되는 매장(레이트리밋 키). join_owners 는 신청 대기 매장, 그 외는 소속 매장.
  const scopeUnit = audience === 'join_owners' ? pendingUnit : callerUnit;
  if (!scopeUnit) return json(403, { error: 'no_unit' });
  if (rateLimited(scopeUnit)) return json(429, { error: 'rate_limited' });

  // ── 대상 사용자 해석 (항상 호출자가 속한/신청한 매장으로 제한) ──
  let recipientIds: string[] = [];
  if (audience === 'user') {
    const target = clip(payload.userId, 80);
    if (!target) return json(400, { error: 'missing_userId' });
    // 대상이 같은 매장인지 확인 — 크로스테넌트 발송 차단.
    const { data: t } = await admin
      .from('profiles').select('id, unit_id').eq('id', target).single();
    if (!t || t.unit_id !== callerUnit) return json(403, { error: 'cross_tenant' });
    recipientIds = [target];
  } else if (audience === 'join_owners') {
    // 합류 신청 알림 — 신청자가 지정한 pending_unit_id 의 사장에게만.
    const { data: rows } = await admin
      .from('profiles').select('id').eq('unit_id', pendingUnit).eq('role', 'owner');
    recipientIds = (rows ?? []).map((r: { id: string }) => r.id);
  } else {
    const role = audience === 'owners' ? 'owner' : 'junior';
    const { data: rows } = await admin
      .from('profiles').select('id').eq('unit_id', callerUnit).eq('role', role);
    recipientIds = (rows ?? []).map((r: { id: string }) => r.id);
  }

  // 발송자 본인에게는 알림을 보내지 않는다(자기 행동의 메아리 방지).
  recipientIds = recipientIds.filter((id) => id !== caller.id);
  if (recipientIds.length === 0) return json(200, { sent: 0, recipients: 0 });

  // ── 수신자 선호 적용 — 'OS 푸시'만 억제 ──────────────────────────────────────────
  // 인앱 알림함(벨/목록)은 클라가 도메인 데이터에서 파생하는 별개 경로라 여기서 아무리 걸러도 그대로 뜬다.
  //   → 방해금지 = "핸드폰 알림만 안 가고 알림함엔 표시" 가 구조적으로 성립.
  // 계층(0076 이관): 계정 전역 notification_prefs = 푸시 수신 on/off 만.
  //   방해금지·음소거는 매장별 unit_member_prefs(user × unit) 로 판정 — 전역 quiet 는 여기서 더 안 본다
  //   (기존 유저의 전역 방해금지값 무시 = 의도된 동작 변화. 매장별 설정 화면이 새 SSOT).
  // 행이 없는 수신자는 기본값(켜짐·음소거/방해금지 꺼짐)으로 발송 대상 유지(신규 사용자 무음화 방지).
  const { data: prefRows } = await admin
    .from('notification_prefs')
    .select('user_id, push_enabled')
    .in('user_id', recipientIds);
  const prefByUser = new Map(
    (prefRows ?? []).map((p: { user_id: string; push_enabled: boolean }) => [p.user_id, p]),
  );
  // 매장별 개인 설정 — 발송 범위 매장(scopeUnit) 기준. join_owners 도 수신자(사장)는 scopeUnit 소속이라 동일 축.
  const { data: unitPrefRows } = await admin
    .from('unit_member_prefs')
    .select('user_id, muted, quiet_enabled, quiet_start, quiet_end')
    .eq('unit_id', scopeUnit)
    .in('user_id', recipientIds);
  const unitPrefByUser = new Map(
    (unitPrefRows ?? []).map((p: { user_id: string; muted: boolean; quiet_enabled: boolean; quiet_start: string; quiet_end: string }) => [p.user_id, p]),
  );
  const nowKst = kstNowHHMM();
  const suppressed: string[] = [];
  recipientIds = recipientIds.filter((id) => {
    const p = prefByUser.get(id);
    if (p && p.push_enabled === false) { suppressed.push(id); return false; } // 계정 전역: 알림 끔 → 발송 안 함
    const up = unitPrefByUser.get(id);
    if (!up) return true; // 매장별 설정 없음 = 기본(발송)
    if (up.muted) { suppressed.push(id); return false; } // 이 매장 음소거 → 발송 안 함
    if (up.quiet_enabled && inQuietWindow(nowKst, up.quiet_start, up.quiet_end)) { suppressed.push(id); return false; } // 이 매장 방해금지 시간 → 이번 발송만 스킵
    return true;
  });
  if (recipientIds.length === 0) return json(200, { sent: 0, recipients: 0, suppressed: suppressed.length });

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', recipientIds);

  const list = subs ?? [];
  const notif = JSON.stringify({ title, body, url: url || '/', tag });

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    list.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          notif,
          {
            TTL: 60 * 60 * 24, // 24h — 오래된 알림은 무의미(기기 오프라인이어도 재접속 시 배달)
            // Urgency:high → 푸시서비스가 '지금 즉시' 배달(APNs priority 10). 기본 'normal'은 배터리
            //   절약을 위해 묶어서 지연 배달될 수 있어, 업무 알림엔 즉시성이 중요하므로 high 로 지정.
            //   (앱이 닫혀 SW가 잠든 경우의 iOS 지연은 OS 소관이라 이걸로도 완전 제거는 불가.)
            urgency: 'high',
          },
        );
        sent += 1;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        // 404/410 = 구독 만료(브라우저가 폐기) → 원장에서 제거
        if (code === 404 || code === 410) dead.push(s.id);
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', dead);
  }

  return json(200, { sent, recipients: recipientIds.length, pruned: dead.length });
});
