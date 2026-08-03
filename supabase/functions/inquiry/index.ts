// supabase/functions/inquiry/index.ts  (Deno / Supabase Edge Function)
// 도입 문의 접수 — 정적 마케팅 페이지(/inquiry)의 폼이 직접 호출한다.
//   ① sales_inquiries(0105)에 리드를 남기고  ② 운영자 메일로 알린다.
//
// 보안 (★ ai/push 와 다른 정책 — otp 와 같은 계열):
//   - 비로그인 방문자가 호출한다 → JWT 검증 없음(config.toml verify_jwt=false).
//   - 그래서 방어선은 아래 두 가지뿐이다.
//       · IP당 10분 3건(인메모리 — 베스트에포트)
//       · 길이 캡을 테이블 CHECK(0105)와 동일하게 서버에서 먼저 자른다
//   - 응답에 저장된 내용을 되돌려주지 않는다(조회 표면 0 — 0105 설계 유지).
//
// ★ 메일은 "있으면 보내고 없으면 건너뛴다".
//   RESEND_API_KEY 가 없으면 리드 저장만 하고 ok 를 준다 — 키를 넣기 전에도 폼이 죽지 않는다.
//   메일 발송 실패도 접수 실패로 만들지 않는다(리드가 이미 DB에 있는데 방문자에게 실패라고
//   말하면 같은 문의를 또 보내게 된다).
//
// 배포:
//   npx supabase secrets set RESEND_API_KEY=re_xxx INQUIRY_TO=cristianojun@naver.com
//   npx supabase functions deploy inquiry

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
// 받는 주소. 미설정 시 대외 대표메일로 폴백(business.ts 와 같은 값).
const MAIL_TO = Deno.env.get('INQUIRY_TO') ?? 'cristianojun@naver.com';
// 보내는 주소. 도메인 인증 전에는 Resend 공용 발신자를 쓴다.
const MAIL_FROM = Deno.env.get('INQUIRY_FROM') ?? '착착 도입문의 <onboarding@resend.dev>';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',').map((s) => s.trim()).filter(Boolean);

const IP_WINDOW_MS = 10 * 60_000;
const IP_CAP = 3;
const ipHits = new Map<string, { n: number; resetAt: number }>();
function ipLimited(ip: string): boolean {
  const now = Date.now();
  const cur = ipHits.get(ip);
  if (!cur || now > cur.resetAt) { ipHits.set(ip, { n: 1, resetAt: now + IP_WINDOW_MS }); return false; }
  cur.n += 1;
  return cur.n > IP_CAP;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin)) ? (origin ?? '*') : '';
  return {
    'Access-Control-Allow-Origin': allow || 'null',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

/** 테이블 CHECK(0105)과 같은 규칙으로 먼저 자른다 — DB 에러 대신 사람이 읽는 메시지를 주기 위해. */
function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sendMail(row: { name: string; phone: string; company: string; message: string }): Promise<string> {
  if (!RESEND_KEY) return 'skipped(no key)';
  const body = {
    from: MAIL_FROM,
    to: [MAIL_TO],
    reply_to: undefined as string | undefined,
    subject: `[착착 도입문의] ${row.company || row.name}`,
    html:
      `<div style="font-family:-apple-system,'Malgun Gothic',sans-serif;line-height:1.7;font-size:15px;color:#111">` +
      `<h2 style="margin:0 0 14px">새 도입 문의</h2>` +
      `<p style="margin:0"><b>이름</b> ${esc(row.name)}</p>` +
      `<p style="margin:0"><b>연락처</b> ${esc(row.phone)}</p>` +
      (row.company ? `<p style="margin:0"><b>브랜드·매장</b> ${esc(row.company)}</p>` : '') +
      (row.message ? `<p style="margin:12px 0 0"><b>내용</b><br>${esc(row.message).replace(/\n/g, '<br>')}</p>` : '') +
      `<p style="margin:18px 0 0;color:#888;font-size:13px">착착 웹 도입 문의 폼 · sales_inquiries 에도 저장됨</p></div>`,
  };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok ? 'sent' : `failed(${r.status})`;
  } catch (_e) {
    return 'failed(network)';
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const H = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method' }), { status: 405, headers: H });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (ipLimited(ip)) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: H });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers: H }); }

  const name = clean(payload.name, 40);
  const phone = clean(payload.phone, 20);
  const company = clean(payload.company, 80);
  const message = clean(payload.message, 1000);
  if (name.length < 1) return new Response(JSON.stringify({ error: 'name_required' }), { status: 400, headers: H });
  if (phone.length < 8) return new Response(JSON.stringify({ error: 'phone_required' }), { status: 400, headers: H });

  // ① 리드 저장이 본체 — 여기서 실패하면 접수 실패로 알린다.
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { error } = await db.from('sales_inquiries').insert({
    user_id: null, name, phone, company: company || null, message: message || null,
  });
  if (error) {
    console.error('[inquiry] insert failed', error.message);
    return new Response(JSON.stringify({ error: 'save_failed' }), { status: 500, headers: H });
  }

  // ② 메일은 부가 — 실패해도 접수는 성공이다.
  const mail = await sendMail({ name, phone, company, message });
  console.log('[inquiry] saved · mail=' + mail);
  return new Response(JSON.stringify({ ok: true }), { headers: H });
});
