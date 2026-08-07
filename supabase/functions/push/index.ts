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
//   supabase secrets set VAPID_PUBLIC_KEY=...  VAPID_PRIVATE_KEY=...  VAPID_SUBJECT=mailto:cristianojun@naver.com
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY 는 플랫폼이 기본 주입)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:cristianojun@naver.com';

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

type Admin = ReturnType<typeof createClient>;

/**
 * 실제 배달 — 수신자 선호 적용 → 구독 조회 → 웹푸시 발송 → 죽은 구독 정리.
 * "누구에게 보낼지"는 호출부가 이미 정했다. 이 함수는 **어떤 경로로 들어왔든 동일하게** 적용돼야 하는
 * 규칙(방해금지·음소거·구독 정리)만 담는다 → 사용자 발송과 크론 리마인더가 같은 한 곳을 쓴다(AGENTS.md ②).
 *
 * ── 수신자 선호 적용 — 'OS 푸시'만 억제 ──────────────────────────────────────────
 * 인앱 알림함(벨/목록)은 클라가 도메인 데이터에서 파생하는 별개 경로라 여기서 아무리 걸러도 그대로 뜬다.
 *   → 방해금지 = "핸드폰 알림만 안 가고 알림함엔 표시" 가 구조적으로 성립.
 * 계층(0076 이관): 계정 전역 notification_prefs = 푸시 수신 on/off 만.
 *   방해금지·음소거는 매장별 unit_member_prefs(user × unit) 로 판정 — 전역 quiet 는 여기서 더 안 본다
 *   (기존 유저의 전역 방해금지값 무시 = 의도된 동작 변화. 매장별 설정 화면이 새 SSOT).
 * 행이 없는 수신자는 기본값(켜짐·음소거/방해금지 꺼짐)으로 발송 대상 유지(신규 사용자 무음화 방지).
 * 선호 조회 실패 = fail-open(전원 발송) — 과알림이 무음 드롭보다 안전. 단 조용히 넘기지 않고
 * 로그를 남긴다(스키마 드리프트가 나도 엣지 로그로 감지 가능 — 2026-07-24 리뷰 반영).
 */
async function deliver(
  admin: Admin,
  scopeUnit: string,
  targets: string[],
  notifIn: { title: string; body: string; url: string; tag?: string },
): Promise<{ sent: number; recipients: number; suppressed: number; pruned: number }> {
  if (targets.length === 0) return { sent: 0, recipients: 0, suppressed: 0, pruned: 0 };

  const { data: prefRows, error: prefErr } = await admin
    .from('notification_prefs')
    .select('user_id, push_enabled')
    .in('user_id', targets);
  if (prefErr) console.error('[push] notification_prefs read failed (fail-open):', prefErr.message);
  const prefByUser = new Map(
    (prefRows ?? []).map((p: { user_id: string; push_enabled: boolean }) => [p.user_id, p]),
  );
  // 매장별 개인 설정 — 발송 범위 매장(scopeUnit) 기준. join_owners 도 수신자(사장)는 scopeUnit 소속이라 동일 축.
  const { data: unitPrefRows, error: unitPrefErr } = await admin
    .from('unit_member_prefs')
    .select('user_id, muted, quiet_enabled, quiet_start, quiet_end')
    .eq('unit_id', scopeUnit)
    .in('user_id', targets);
  if (unitPrefErr) console.error('[push] unit_member_prefs read failed (fail-open):', unitPrefErr.message);
  const unitPrefByUser = new Map(
    (unitPrefRows ?? []).map((p: { user_id: string; muted: boolean; quiet_enabled: boolean; quiet_start: string; quiet_end: string }) => [p.user_id, p]),
  );
  const nowKst = kstNowHHMM();
  const suppressed: string[] = [];
  const recipientIds = targets.filter((id) => {
    const p = prefByUser.get(id);
    if (p && p.push_enabled === false) { suppressed.push(id); return false; } // 계정 전역: 알림 끔 → 발송 안 함
    const up = unitPrefByUser.get(id);
    if (!up) return true; // 매장별 설정 없음 = 기본(발송)
    if (up.muted) { suppressed.push(id); return false; } // 이 매장 음소거 → 발송 안 함
    if (up.quiet_enabled && inQuietWindow(nowKst, up.quiet_start, up.quiet_end)) { suppressed.push(id); return false; } // 이 매장 방해금지 시간 → 이번 발송만 스킵
    return true;
  });
  if (recipientIds.length === 0) return { sent: 0, recipients: 0, suppressed: suppressed.length, pruned: 0 };

  const { data: subs, error: subsErr } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', recipientIds);
  // 조회 실패를 삼키면 "구독 없음(sent:0)"으로 위장된다 — 원인 규명을 위해 로그는 남긴다.
  if (subsErr) console.error('push: subscriptions read failed:', subsErr.message);

  const list = subs ?? [];
  const notif = JSON.stringify({ title: notifIn.title, body: notifIn.body, url: notifIn.url || '/', tag: notifIn.tag });

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
        // 그 외(400/413/429/5xx)는 무음으로 삼키면 "특정 사용자만 푸시 안 옴"의 흔적이 안 남는다.
        else console.error('push: send failed:', code ?? 'no-status', (e as Error)?.message ?? String(e));
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', dead);
  }

  return { sent, recipients: recipientIds.length, suppressed: suppressed.length, pruned: dead.length };
}

/**
 * 할일 시간대 알림 스윕(0118) — pg_cron 이 5분마다 부른다.
 * 입력이 없다: 제목·본문·수신자를 전부 due_task_reminders() 가 정한다(수신자 규칙 SSOT = DB).
 * 순서가 중요하다 — **발송 전에** task_reminder_sent 를 선점(insert)한다. PK(template_id, remind_date)
 * 충돌이 곧 잠금이라, 크론이 겹쳐 돌거나 재시도해도 같은 할일이 두 번 나가지 않는다.
 * (발송 후 기록으로 하면 그 사이에 두 번째 실행이 끼어들어 중복 발송된다.)
 */
async function sweepTaskReminders(token: string): Promise<{ swept: number; sent: number; error?: string }> {
  // 인증 = "이 토큰으로 due_task_reminders 를 실행할 수 있는가". 0118 에서 anon/authenticated 에게
  // revoke 했으므로 service_role 만 통과한다. SERVICE_ROLE 문자열 비교로 하면 프로젝트가 새 API 키
  // 체계로 바뀌었을 때 조용히 어긋난다(2026-08-06 실측: 유효한 키인데 401).
  const admin = createClient(SUPABASE_URL, token);
  const { data, error } = await admin.rpc('due_task_reminders');
  if (error) {
    console.error('[push] due_task_reminders failed:', error.message);
    const denied = /permission denied|not exist/i.test(error.message);
    return { swept: 0, sent: 0, error: denied ? 'forbidden' : 'rpc_failed' };
  }
  const rows = (data ?? []) as {
    out_template_id: string; out_unit_id: string; out_text: string; out_date: string; out_recipients: string[];
  }[];
  let sent = 0;
  for (const r of rows) {
    const { error: claimErr } = await admin.from('task_reminder_sent').insert({
      template_id: r.out_template_id,
      remind_date: r.out_date,
      unit_id: r.out_unit_id,
      recipients: r.out_recipients.length,
    });
    if (claimErr) continue; // 이미 다른 실행이 가져감(중복 키) → 건너뛴다.
    const res = await deliver(admin, r.out_unit_id, r.out_recipients, {
      title: '할일 시간이에요',
      body: r.out_text,
      url: '/junior/work',
      tag: `task-${r.out_template_id}`,
    });
    sent += res.sent;
  }
  return { swept: rows.length, sent };
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

  let payload: {
    mode?: string;
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

  // ── 크론 경로(0118 할일 시간대 알림) ──
  // 사용자 JWT 가 아니라 service_role 키로 들어온다(pg_cron → net.http_post). 사용자 입력이 0이고
  // (mode 하나뿐) 제목·본문·수신자를 DB 가 정하므로, 아래의 "호출자 매장으로 제한" 검사가 필요 없다.
  // 인증은 sweepTaskReminders 안에서 RPC 실행 권한으로 판정한다.
  if (payload.mode) {
    if (payload.mode !== 'task_reminders') return json(400, { error: 'unknown_mode' });
    const swept = await sweepTaskReminders(token);
    return json(swept.error === 'forbidden' ? 403 : 200, swept);
  }

  // 호출자 신원 확인용(anon 키 + 호출자 토큰)
  const asCaller = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  const caller = userData?.user;
  if (userErr || !caller) return json(401, { error: 'unauthorized' });

  // 조회/발송은 service_role(RLS 우회) — 대상 프로필·구독을 읽어야 한다.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 호출자의 매장 + 신청 대기중 매장(pending_unit_id).
  // 0093: 주매장(unit_id) 고정 → 활성 매장(active_unit_id) 우선으로 교정 — 다점포에서 "2호점을 보며
  // 보낸 알림이 1호점으로 가는" 무음 오발송 방지(0056 이 RPC 에서 고친 것과 같은 클래스).
  // active_unit_id 는 RLS 로 동결돼 switch_active_unit(멤버십 검증)로만 바뀌므로 신뢰 가능.
  const { data: me } = await admin
    .from('profiles').select('unit_id, active_unit_id, pending_unit_id, role').eq('id', caller.id).single();
  const callerUnit = (me?.active_unit_id ?? me?.unit_id) as string | null;
  const pendingUnit = me?.pending_unit_id as string | null;

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
    // 대상이 같은 매장 멤버인지 확인 — 크로스테넌트 발송 차단.
    // 0093: 판정을 profiles.unit_id(주매장) → unit_members(매장별 멤버십 SSOT)로 교체 —
    // 주매장이 다른 멤버(다점포 직원·매니저)에게 가던 멘션/배정 알림이 403 으로 죽던 갭도 함께 해소.
    const { data: t } = await admin
      .from('unit_members').select('user_id').eq('user_id', target).eq('unit_id', callerUnit).maybeSingle();
    if (!t) return json(403, { error: 'cross_tenant' });
    recipientIds = [target];
  } else if (audience === 'join_owners') {
    // 합류 신청 알림 — 신청자가 지정한 pending_unit_id 의 관리자(사장+매니저, 0093 승인권자)에게만.
    // 0093: 대상 해석을 profiles(주매장·전역 role) → unit_members(매장별 멤버십·역할 SSOT, 0067)로 교체.
    const { data: rows } = await admin
      .from('unit_members').select('user_id').eq('unit_id', pendingUnit).in('role', ['owner', 'manager']);
    recipientIds = (rows ?? []).map((r: { user_id: string }) => r.user_id);
  } else {
    // 0093: 'owners' = 그 매장의 관리자(사장+매니저), 'staff' = 그 매장의 직원(junior).
    // unit_members 기준이라 주매장이 다른 멤버도 정확히 잡히고, 매니저가 staff 쪽으로 중복 수신하지 않는다.
    const roles = audience === 'owners' ? ['owner', 'manager'] : ['junior'];
    const { data: rows } = await admin
      .from('unit_members').select('user_id').eq('unit_id', callerUnit).in('role', roles);
    recipientIds = (rows ?? []).map((r: { user_id: string }) => r.user_id);
  }

  // 발송자 본인에게는 알림을 보내지 않는다(자기 행동의 메아리 방지).
  recipientIds = recipientIds.filter((id) => id !== caller.id);
  if (recipientIds.length === 0) return json(200, { sent: 0, recipients: 0 });

  const r = await deliver(admin, scopeUnit, recipientIds, { title, body, url, tag });
  return json(200, { sent: r.sent, recipients: r.recipients, pruned: r.pruned, suppressed: r.suppressed });
});
