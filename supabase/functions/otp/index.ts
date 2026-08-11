// supabase/functions/otp/index.ts  (Deno / Supabase Edge Function)
// 전화번호 SMS 인증 — 6자리 코드를 솔라피로 발송(action=send)하고 대조(action=verify)한다.
// 인증 성공은 phone_otps.verified_at 에 남고, 서버 게이트(migrations/_hold/0088)가 그 행을 본다.
//
// 보안 (★ ai/push 와 다른 정책 — 반드시 읽을 것):
//   - 이 함수는 "가입 전(무세션)" 사용자가 호출한다 → JWT 검증이 없다(config.toml verify_jwt=false).
//   - 따라서 유일한 방어선은 아래 레이트리밋이다. SMS는 건당 과금(약 9원)이라 뚫리면 바로 돈이 샌다.
//       · 같은 번호 재발송 쿨다운 60초 + 일일 5건 (phone_otps 행 기반 — 인스턴스 재시작과 무관)
//       · IP당 분당 3건 (★0124: DB 기반 — 예전 인메모리 Map 은 isolate 로컬이라 실측 24발 전부 통과했다)
//       · 코드 3분 만료 · 오답 5회면 코드 무효(온라인 브루트포스 차단: 6자리×5회)
//   - 코드는 평문 저장하지 않는다(sha256). 응답에 코드·해시를 절대 싣지 않는다.
//
// 배포:
//   npx supabase secrets set --env-file supabase/.env.solapi
//   npx supabase functions deploy otp
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 플랫폼이 기본 주입)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SOLAPI_KEY = Deno.env.get('SOLAPI_API_KEY') ?? '';
const SOLAPI_SECRET = Deno.env.get('SOLAPI_API_SECRET') ?? '';
const SOLAPI_FROM = (Deno.env.get('SOLAPI_FROM') ?? '').replace(/\D/g, '');

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',').map((s) => s.trim()).filter(Boolean);

const COOLDOWN_SEC = 60;
const DAILY_CAP = 5;
const CODE_TTL_MIN = 3;
const MAX_ATTEMPTS = 5;
const IP_RATE_PER_MIN = 3;

// IP 레이트리밋 — 판정·카운트는 DB(0124 otp_ip_hit)에서 원자적으로. 인스턴스가 갈려도 유효하다.
// ★ 실패 시 fail-closed(막는다): 여기가 뚫리면 곧바로 과금이므로 "DB가 아프면 통과"는 선택지가 아니다.
// deno-lint-ignore no-explicit-any
async function ipLimited(admin: any, ip: string): Promise<boolean> {
  const { data, error } = await admin.rpc('otp_ip_hit', { p_ip: ip, p_per_min: IP_RATE_PER_MIN });
  if (error) {
    console.error('otp: ip rate check failed:', error.message);
    return true;
  }
  return data === true;
}

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

// 클라 validation.ts·DB normalize_phone(0022)과 같은 규칙 — parity가 깨지면 게이트 판정이 어긋난다.
function normalizePhone(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.startsWith('82') ? '0' + d.slice(2) : d;
}
const isValidPhone = (p: string) => /^01[016789]\d{7,8}$/.test(p);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 솔라피 HMAC-SHA256 인증 헤더 (https://developers.solapi.com — signature = HMAC(secret, date+salt))
async function solapiAuthHeader(): Promise<string> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SOLAPI_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${hex}`;
}

async function sendSms(to: string, text: string): Promise<void> {
  const res = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { 'Authorization': await solapiAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { to, from: SOLAPI_FROM, text } }),
  });
  if (!res.ok) throw new Error(`solapi ${res.status}: ${await res.text()}`);
}

function json(status: number, body: unknown, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, reason: 'method' }, cors);

  let body: { action?: string; phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: 'bad_json' }, cors);
  }

  const phone = normalizePhone(body.phone);
  if (!isValidPhone(phone)) return json(400, { ok: false, reason: 'invalid_phone' }, cors);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  if (body.action === 'send') {
    // ★ IP 를 못 알아내면 이 축은 **건너뛴다**. 예전 인메모리판은 'unknown' 이라는 공용 버킷으로 셌는데,
    //   그때는 리밋 자체가 안 걸려 무해했다. DB 로 옮기면 그 순간부터 실제로 걸리므로,
    //   헤더가 없는 환경에서는 **모든 사용자가 분당 3건을 나눠 쓰는** 전면 장애가 된다.
    //   귀속할 수 없는 요청은 IP 축으로 막지 않는다 — 번호별 쿨다운·일일캡은 그대로 적용된다.
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    // retry_after_sec 를 함께 싣는다 — 없으면 화면이 "잠시 후"밖에 말할 수 없고,
    // 사용자는 얼마나 기다릴지 몰라 계속 누른다(2026-08-11 QA P1-#3). 창은 고정 1분.
    if (ip && (await ipLimited(admin, ip))) {
      return json(429, { ok: false, reason: 'rate_limited', retry_after_sec: 60 }, cors);
    }
    if (!SOLAPI_KEY || !SOLAPI_SECRET || !SOLAPI_FROM) {
      return json(500, { ok: false, reason: 'not_configured' }, cors);
    }

    const { data: row, error: selErr } = await admin
      .from('phone_otps').select('*').eq('phone', phone).maybeSingle();
    if (selErr) return json(500, { ok: false, reason: 'db' }, cors);

    const now = Date.now();
    let sentCount = 1;
    let sentResetAt = new Date(now + 86_400_000).toISOString();
    if (row) {
      const sinceLast = now - new Date(row.last_sent_at).getTime();
      if (sinceLast < COOLDOWN_SEC * 1000) {
        return json(429, {
          ok: false,
          reason: 'cooldown',
          retry_after_sec: Math.ceil((COOLDOWN_SEC * 1000 - sinceLast) / 1000),
        }, cors);
      }
      const resetAt = new Date(row.sent_reset_at).getTime();
      if (now < resetAt) {
        if (row.sent_count >= DAILY_CAP) {
          return json(429, {
            ok: false,
            reason: 'daily_cap',
            retry_after_sec: Math.ceil((resetAt - now) / 1000),
          }, cors);
        }
        sentCount = row.sent_count + 1;
        sentResetAt = row.sent_reset_at;
      }
    }

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    // 발송 "전에" 기록한다 — 솔라피 발송이 실패해도 카운트는 소모(과금 폭주 방어가 UX보다 우선).
    // verified_at 은 upsert 컬럼에 넣지 않는다 → 기존 인증 이력이 재발송으로 지워지지 않는다.
    const { error: upErr } = await admin.from('phone_otps').upsert({
      phone,
      code_hash: await sha256Hex(`${phone}:${code}`),
      expires_at: new Date(now + CODE_TTL_MIN * 60_000).toISOString(),
      attempts: 0,
      last_sent_at: new Date(now).toISOString(),
      sent_count: sentCount,
      sent_reset_at: sentResetAt,
    }, { onConflict: 'phone' });
    if (upErr) return json(500, { ok: false, reason: 'db' }, cors);

    try {
      await sendSms(phone, `[매장의 정석] 인증번호 ${code}\n3분 안에 입력해 주세요.`);
    } catch (e) {
      console.error('solapi send failed:', e);
      return json(502, { ok: false, reason: 'send_failed' }, cors);
    }
    return json(200, { ok: true }, cors);
  }

  if (body.action === 'verify') {
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (code.length !== 6) return json(400, { ok: false, reason: 'mismatch' }, cors);

    const { data: row, error: selErr } = await admin
      .from('phone_otps').select('*').eq('phone', phone).maybeSingle();
    if (selErr) return json(500, { ok: false, reason: 'db' }, cors);
    if (!row) return json(400, { ok: false, reason: 'expired' }, cors);
    if (row.attempts >= MAX_ATTEMPTS) return json(429, { ok: false, reason: 'too_many' }, cors);
    if (Date.now() > new Date(row.expires_at).getTime()) {
      return json(400, { ok: false, reason: 'expired' }, cors);
    }

    if (await sha256Hex(`${phone}:${code}`) !== row.code_hash) {
      // 카운터 증가가 무음 실패하면 5회 상한(브루트포스 방어선)이 무력화된다 — 실패 시 진행 거부.
      const { error: aErr } = await admin.from('phone_otps').update({ attempts: row.attempts + 1 }).eq('phone', phone);
      if (aErr) { console.error('otp: attempts update failed:', aErr.message); return json(500, { ok: false, reason: 'db' }, cors); }
      return json(400, { ok: false, reason: 'mismatch' }, cors);
    }

    const { error: vErr } = await admin.from('phone_otps')
      .update({ verified_at: new Date().toISOString() }).eq('phone', phone);
    if (vErr) return json(500, { ok: false, reason: 'db' }, cors);
    return json(200, { ok: true }, cors);
  }

  return json(400, { ok: false, reason: 'bad_action' }, cors);
});
