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
//   - (0238) 코드는 한 번만 쓴다. verify·change_phone·find_email·reset_password 가 성공하면 expires_at 을 지금으로 당긴다.
//     verify 를 부르는 화면(가입·프로필 완성·번호 인증 블록·게스트 퀴즈)은 그 뒤에 같은 코드를 다시 쓰지 않는다.
//     비밀번호 찾기는 verify 없이 reset_password 에 코드를 바로 싣는다.
//   - (0238) JWT 가 실려 오면(로그인 상태) 함수 안에서 getUser 로 확인한다. verify 는 그 사용자를 verified_by 에 남기고,
//     change_phone 은 JWT 가 없으면 401 이다(verify_jwt=false 라 게이트웨이가 대신 막지 않는다).
//
// 배포:
//   npx supabase secrets set --env-file supabase/.env.solapi
//   npx supabase functions deploy otp
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 플랫폼이 기본 주입)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { maskEmail } from './helpers.ts';

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

// 코드 대조 — 만료 3분·오답 5회·해시. 틀리면 오답 횟수를 올린다(무음 실패 시 진행 거부).
type CodeCheck = { ok: true; row: { code_hash: string } } | { ok: false; status: number; reason: string };
// deno-lint-ignore no-explicit-any
async function matchCode(admin: any, phone: string, code: string): Promise<CodeCheck> {
  if (code.length !== 6) return { ok: false, status: 400, reason: 'mismatch' };
  const { data: row, error: selErr } = await admin
    .from('phone_otps').select('*').eq('phone', phone).maybeSingle();
  if (selErr) return { ok: false, status: 500, reason: 'db' };
  if (!row) return { ok: false, status: 400, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, status: 429, reason: 'too_many' };
  if (Date.now() > new Date(row.expires_at).getTime()) return { ok: false, status: 400, reason: 'expired' };
  if (await sha256Hex(`${phone}:${code}`) !== row.code_hash) {
    const { error: aErr } = await admin.from('phone_otps').update({ attempts: row.attempts + 1 }).eq('phone', phone);
    if (aErr) { console.error('otp: attempts update failed:', aErr.message); return { ok: false, status: 500, reason: 'db' }; }
    return { ok: false, status: 400, reason: 'mismatch' };
  }
  return { ok: true, row };
}

// 코드 소모 — 아직 유효한 같은 코드일 때만 expires_at 을 지금으로 당긴다. 동시에 두 요청이 와도 한쪽만 이긴다.
// 'taken' = 다른 요청이 먼저 썼거나 그사이 새 코드가 발송됐다(→ expired 로 답한다).
// deno-lint-ignore no-explicit-any
async function consumeCode(admin: any, phone: string, codeHash: string, extra: Record<string, unknown> = {}): Promise<'ok' | 'taken' | 'db'> {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin.from('phone_otps')
    .update({ expires_at: nowIso, ...extra })
    .eq('phone', phone).eq('code_hash', codeHash).gt('expires_at', nowIso)
    .select('phone');
  if (error) { console.error('otp: consume failed:', error.message); return 'db'; }
  return data && data.length > 0 ? 'ok' : 'taken';
}

// 요청에 실린 사용자 JWT 를 확인한다. anon 키·만료·위조면 null.
// deno-lint-ignore no-explicit-any
async function jwtUserId(admin: any, req: Request): Promise<string | null> {
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const { data, error } = await admin.auth.getUser(m[1]);
  return error || !data?.user ? null : data.user.id;
}

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, reason: 'method' }, cors);

  let body: { action?: string; phone?: string; code?: string; role?: string };
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
    // 카운터 증가가 무음 실패하면 5회 상한(브루트포스 방어선)이 무력화된다 — matchCode 가 실패 시 진행 거부.
    const m = await matchCode(admin, phone, code);
    if (!m.ok) return json(m.status, { ok: false, reason: m.reason }, cors);

    // (0238) 로그인 상태면 인증한 사람을 남긴다. 번호 트리거는 본인 인증 15분, 기록 없는 인증 5분만 받는다.
    const uid = await jwtUserId(admin, req);

    // (0238 M4) 중복 확인은 코드가 맞은 뒤에만 알려 준다. role 을 안 보낸 옛 앱에는 null.
    let inUse: boolean | null = null;
    const role = body.role === 'owner' || body.role === 'junior' ? body.role : null;
    if (role) {
      let q = admin.from('profiles').select('id')
        .eq('phone_norm', phone).eq('signup_role', role).is('deleted_at', null);
      if (uid) q = q.neq('id', uid);
      const { data: dup, error: dErr } = await q.limit(1);
      if (dErr) return json(500, { ok: false, reason: 'db' }, cors);
      inUse = (dup ?? []).length > 0;
    }

    const c = await consumeCode(admin, phone, m.row.code_hash, {
      verified_at: new Date().toISOString(),
      verified_by: uid,
    });
    if (c === 'db') return json(500, { ok: false, reason: 'db' }, cors);
    if (c === 'taken') return json(400, { ok: false, reason: 'expired' }, cors);
    return json(200, { ok: true, in_use: inUse }, cors);
  }

  // ── 번호 바꾸기(0238 Q13) — 로그인 필수. send(위) → 새 번호의 코드와 함께 부른다 ───────────
  // 같은 가입 역할의 다른 계정이 그 번호를 쓰면 phone_taken. 번호 저장은 service_role 로 한다(트리거 검사 밖).
  if (body.action === 'change_phone') {
    const uid = await jwtUserId(admin, req);
    if (!uid) return json(401, { ok: false, reason: 'unauthorized' }, cors);

    const code = String(body.code ?? '').replace(/\D/g, '');
    const m = await matchCode(admin, phone, code);
    if (!m.ok) return json(m.status, { ok: false, reason: m.reason }, cors);

    const { data: me, error: meErr } = await admin
      .from('profiles').select('id, signup_role, phone_norm, deleted_at').eq('id', uid).maybeSingle();
    if (meErr) return json(500, { ok: false, reason: 'db' }, cors);
    if (!me || me.deleted_at) return json(401, { ok: false, reason: 'unauthorized' }, cors);

    if (me.phone_norm !== phone) {
      const { data: dup, error: dErr } = await admin.from('profiles').select('id')
        .eq('phone_norm', phone).eq('signup_role', me.signup_role).is('deleted_at', null).neq('id', uid).limit(1);
      if (dErr) return json(500, { ok: false, reason: 'db' }, cors);
      if ((dup ?? []).length > 0) return json(409, { ok: false, reason: 'phone_taken' }, cors);
    }

    const c = await consumeCode(admin, phone, m.row.code_hash, {
      verified_at: new Date().toISOString(),
      verified_by: uid,
    });
    if (c === 'db') return json(500, { ok: false, reason: 'db' }, cors);
    if (c === 'taken') return json(400, { ok: false, reason: 'expired' }, cors);

    if (me.phone_norm !== phone) {
      const { error: uErr } = await admin.from('profiles')
        .update({ phone, phone_last4: phone.slice(-4) }).eq('id', uid);
      if (uErr) {
        // 위 확인과 저장 사이에 다른 계정이 같은 번호를 잡았다(ux_profiles_phone_norm_role).
        if (uErr.code === '23505') return json(409, { ok: false, reason: 'phone_taken' }, cors);
        console.error('otp: change_phone update failed:', uErr.message);
        return json(500, { ok: false, reason: 'db' }, cors);
      }
    }
    return json(200, { ok: true, phone_last4: phone.slice(-4) }, cors);
  }

  // ── 이메일 찾기(0238 Q15) — 번호 주인임을 코드로 증명하면 그 번호의 계정 이메일을 가려서 준다 ──
  // 가입 역할마다 최대 1개(0157 유니크)라 최대 2개. 구글로 가입한 계정은 provider='google' 을 단다.
  if (body.action === 'find_email') {
    const code = String(body.code ?? '').replace(/\D/g, '');
    const m = await matchCode(admin, phone, code);
    if (!m.ok) return json(m.status, { ok: false, reason: m.reason }, cors);

    const { data: profs, error: pErr } = await admin.from('profiles').select('id, signup_role')
      .eq('phone_norm', phone).is('deleted_at', null).order('signup_role').limit(2);
    if (pErr) return json(500, { ok: false, reason: 'db' }, cors);

    const c = await consumeCode(admin, phone, m.row.code_hash);
    if (c === 'db') return json(500, { ok: false, reason: 'db' }, cors);
    if (c === 'taken') return json(400, { ok: false, reason: 'expired' }, cors);
    if (!profs || profs.length === 0) return json(404, { ok: false, reason: 'no_account' }, cors);

    const accounts: { role: string; email: string; provider: 'google' | 'email' }[] = [];
    for (const p of profs) {
      const { data: u, error: gErr } = await admin.auth.admin.getUserById(p.id);
      if (gErr || !u?.user) { console.error('otp: find_email getUser failed:', gErr?.message); continue; }
      accounts.push({
        role: p.signup_role,
        email: maskEmail(u.user.email),
        provider: u.user.app_metadata?.provider === 'google' ? 'google' : 'email',
      });
    }
    if (accounts.length === 0) return json(500, { ok: false, reason: 'db' }, cors);
    return json(200, { ok: true, accounts }, cors);
  }

  // ── 비밀번호 재설정(2026-09-23 사용자 결정: 이메일이 아니라 **전화번호 인증**으로) ─────────
  // 흐름: send(위) → 사용자가 인증번호 + 새 비밀번호를 한 번에 보낸다. 코드 대조는 verify 와 같은 규칙
  // (만료 3분·오답 5회·해시)이고, 맞으면 그 번호·역할의 계정 비밀번호를 admin 으로 바꾼다.
  // 같은 번호가 사장·직원 두 계정을 가질 수 있어(가입 규칙) role 을 받는다. 번호 소유를 증명한 사람에게
  // "그 역할 계정이 없다"는 답은 노출이 아니다(자기 번호). 코드는 한 번 쓰면 만료시켜 재사용을 막는다.
  if (body.action === 'reset_password') {
    const b = body as { code?: string; role?: string; new_password?: string };
    const code = String(b.code ?? '').replace(/\D/g, '');
    const role = b.role === 'owner' || b.role === 'junior' ? b.role : null;
    const newPw = String(b.new_password ?? '');
    if (code.length !== 6) return json(400, { ok: false, reason: 'mismatch' }, cors);
    if (!role) return json(400, { ok: false, reason: 'bad_action' }, cors);
    if (newPw.length < 9 || newPw.length > 72) return json(400, { ok: false, reason: 'weak_password' }, cors);

    const m = await matchCode(admin, phone, code);
    if (!m.ok) return json(m.status, { ok: false, reason: m.reason }, cors);

    // 계정 찾기 — profiles.phone_norm(0022 generated) + **signup_role**(0238 Q18). 탈퇴(deleted_at) 계정은 제외.
    //   profiles.role 은 지금 권한이라 매장을 아직 안 만든 사장은 junior 다. 가입 역할로 찾아야 맞는 계정이 나온다.
    //   (phone_norm, signup_role) 은 0157 유니크라 최대 1행이다. 2행이면 불변식이 깨진 것 — 아무 쪽도 바꾸지 않는다.
    const { data: profs, error: pErr } = await admin
      .from('profiles').select('id').eq('phone_norm', phone).eq('signup_role', role).is('deleted_at', null).limit(2);
    if (pErr) return json(500, { ok: false, reason: 'db' }, cors);
    if (profs && profs.length > 1) {
      console.error('otp: reset_password found 2 accounts for one (phone_norm, signup_role)', role);
      return json(500, { ok: false, reason: 'db' }, cors);
    }
    if (!profs || profs.length === 0) {
      // 다른 가입 역할에만 계정이 있으면 그 역할을 알려 준다(코드로 번호 주인임을 증명했으므로 노출이 아니다).
      // 코드는 소모하지 않는다 — 화면이 역할을 바꿔 같은 코드로 다시 보낸다.
      const { data: other } = await admin.from('profiles').select('signup_role')
        .eq('phone_norm', phone).neq('signup_role', role).is('deleted_at', null).limit(1);
      const otherRole = other?.[0]?.signup_role;
      return json(404, otherRole ? { ok: false, reason: 'no_account', other_role: otherRole } : { ok: false, reason: 'no_account' }, cors);
    }
    const uid = profs[0].id as string;

    // 코드 소모 먼저 — 같은 코드로 두 번 바꾸지 못한다. verified_at 은 인증 이력이라 같이 남기고, 인증한 사람은 그 계정이다.
    const c = await consumeCode(admin, phone, m.row.code_hash, {
      verified_at: new Date().toISOString(),
      verified_by: uid,
    });
    if (c === 'db') return json(500, { ok: false, reason: 'db' }, cors);
    if (c === 'taken') return json(400, { ok: false, reason: 'expired' }, cors);

    const { data: upd, error: uErr } = await admin.auth.admin.updateUserById(uid, { password: newPw });
    if (uErr) { console.error('otp: password update failed:', uErr.message); return json(500, { ok: false, reason: 'db' }, cors); }

    // (0238 A4) 다른 기기 세션을 모두 끊는다. 비밀번호는 이미 바뀌었으므로 실패해도 성공으로 답하고 로그만 남긴다.
    const { error: rErr } = await admin.rpc('revoke_user_sessions', { p_uid: uid });
    if (rErr) console.error('otp: revoke_user_sessions failed:', rErr.message);

    // (0238 Q15) 어느 이메일로 로그인하면 되는지 가려서 알려 준다.
    return json(200, {
      ok: true,
      email: maskEmail(upd?.user?.email),
      provider: upd?.user?.app_metadata?.provider === 'google' ? 'google' : 'email',
    }, cors);
  }

  return json(400, { ok: false, reason: 'bad_action' }, cors);
});
